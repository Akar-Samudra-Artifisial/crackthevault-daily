import { randomInt, randomUUID } from 'node:crypto';
import { redis } from '@devvit/web/server';
import {
  parseStoredBoardEntry,
  parseStoredCrack,
  parseStoredDeepest,
  type GuessRejectCode,
  type GuessResult,
} from '../../shared/api';
import {
  GUESS_TX_ATTEMPTS,
  execFailureOutcome,
  isExecAborted,
  retryDelayMs,
} from '../../shared/tx';
import {
  BOARD_SEND_LIMIT,
  CRACKS_SEND_LIMIT,
  DAY_KEY_TTL_SECONDS,
  GUESSES_PER_DAY,
  codeSpaceSize,
  decodeCode,
  encodeCode,
  generateSecret,
  guessesLeft,
  metaToHash,
  parseMetaHash,
  planGuess,
  remainingCodes,
  specFor,
  type BoardEntry,
  type CrackRecord,
  type DeepestRecord,
  type GuessPlan,
  type VaultMeta,
  type VaultSpec,
} from '../../shared/vault';
import {
  dayStartMs,
  decodeDrillOrder,
  drillView,
  encodeDrillOrder,
  generateDrillOrder,
  type DrillView,
} from '../../shared/drill';
import {
  CODES_LEFT_LOCK_SECONDS,
  codesLeftLockSuffix,
  encodeCodesLeft,
  fallbackCodesLeft,
  parseCodesLeft,
  planCodesLeft,
  type CodesLeftVersion,
  type CodesLeftView,
} from '../../shared/codes-left';
import { nextStreak, parseStreak, visibleStreak } from '../../shared/streak';
import { deepestOf } from '../../shared/safecracker';
import { setNx } from './post';
import { subKeys, vaultKeys } from './keys';

type Keys = ReturnType<typeof vaultKeys>;
type TxClient = Awaited<ReturnType<typeof redis.watch>>;

const ttlDate = (): Date => new Date(Date.now() + DAY_KEY_TTL_SECONDS * 1000);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const newSecret = (spec: VaultSpec): string =>
  encodeCode(generateSecret(spec, (max) => randomInt(max)));

/** Meta of the day; a corrupt hash is logged and refused (never reset to a fresh day). */
const loadMeta = async (keys: Keys): Promise<VaultMeta> => {
  const parsed = parseMetaHash(await redis.hGetAll(keys.meta));
  if (!parsed.ok) {
    console.error(`[vault] corrupt ${keys.meta}: ${parsed.reason}`);
    throw new Error(`corrupt ${keys.meta}`);
  }
  return parsed.meta;
};

/**
 * Secret of `round`. Round 1 is created lazily (SET NX); later rounds are written in the
 * transaction that cracks the previous one, so a missing one is an error and is never
 * re-rolled. Server-only: never returned to clients while the round is active.
 */
const loadSecret = async (
  keys: Keys,
  spec: VaultSpec,
  round: number
): Promise<number[]> => {
  const key = keys.secret(round);
  const existing = decodeCode(await redis.get(key), spec);
  if (existing) return existing;
  if (round !== 1)
    throw new Error(`secret ${key} is missing or does not match today's spec`);
  // Start time BEFORE the secret: whoever sees the secret also sees its start (round1StartMs).
  await setNx(keys.firstStart, String(Date.now()), DAY_KEY_TTL_SECONDS);
  await setNx(key, newSecret(spec), DAY_KEY_TTL_SECONDS);
  const stored = decodeCode(await redis.get(key), spec);
  if (!stored)
    throw new Error(`secret ${key} is missing or does not match today's spec`);
  return stored;
};

const newDrillOrder = (dials: number): string =>
  encodeDrillOrder(generateDrillOrder(dials, (max) => randomInt(max)));

/**
 * Drill opening order of `round`, created with its secret (round 1: lazily via SET NX; later
 * rounds: in the crack transaction). A missing order (e.g. a round started before the drill
 * shipped) is created once with SET NX, so every reader agrees on it. Server-only.
 */
const loadDrillOrder = async (
  keys: Keys,
  spec: VaultSpec,
  round: number
): Promise<number[]> => {
  const key = keys.drill(round);
  const existing = decodeDrillOrder(await redis.get(key), spec.dials);
  if (existing) return existing;
  if (round !== 1)
    console.warn(`[vault] drill order ${key} missing, creating it`);
  await setNx(key, newDrillOrder(spec.dials), DAY_KEY_TTL_SECONDS);
  const stored = decodeDrillOrder(await redis.get(key), spec.dials);
  if (!stored) throw new Error(`drill order ${key} is corrupt`);
  return stored;
};

/**
 * Public drill state of the active round. The reveal count is derived from the round start
 * and the clock on every read (never written step by step), so concurrent requests agree.
 * The secret is read here only to hand it to drillView, whose revealDials returns at most
 * dials − 1 opened digits; the secret itself never leaves this function.
 */
const START_MS_RE = /^\d{1,15}$/;

const readFirstStart = async (keys: Keys): Promise<number | null> => {
  const raw = await redis.get(keys.firstStart);
  return raw !== undefined && raw !== null && START_MS_RE.test(raw)
    ? Number(raw)
    : null;
};

/**
 * When vault #1 really started: the moment its secret was first created (`:start1`, written
 * just before the secret), so a late post does not open drill dials before anyone played.
 * A day whose secret predates `:start1` (old data) falls back to 00:00 UTC. Not kept in
 * `:meta`: that hash is WATCHed and rewritten by every guess transaction.
 */
const round1StartMs = async (keys: Keys, day: string): Promise<number> => {
  const first = await readFirstStart(keys);
  if (first !== null) return first;
  if ((await redis.get(keys.secret(1))) !== undefined) {
    // The creator writes :start1 before the secret, so re-reading now settles the race;
    // still missing means the secret is older than :start1.
    return (await readFirstStart(keys)) ?? dayStartMs(day);
  }
  await setNx(keys.firstStart, String(Date.now()), DAY_KEY_TTL_SECONDS);
  return (await readFirstStart(keys)) ?? dayStartMs(day);
};

const loadDrill = async (
  keys: Keys,
  day: string,
  spec: VaultSpec,
  meta: VaultMeta
): Promise<DrillView> => {
  const startMs =
    meta.roundStartMs > 0
      ? meta.roundStartMs
      : meta.round === 1
        ? await round1StartMs(keys, day)
        : dayStartMs(day);
  const [secret, order] = await Promise.all([
    loadSecret(keys, spec, meta.round),
    loadDrillOrder(keys, spec, meta.round),
  ]);
  return drillView({ secret, order, startMs, nowMs: Date.now() });
};

const parseUsed = (raw: string | undefined): number => {
  const n = raw === undefined ? 0 : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

export type PublicVaultState = {
  /** Spec of the active round. */
  spec: VaultSpec;
  meta: VaultMeta;
  board: BoardEntry[];
  boardTotal: number;
  codesLeft: CodesLeftView;
  drill: DrillView;
  cracks: CrackRecord[];
  cracksTotal: number;
  deepest: DeepestRecord | null;
  guessesUsed: number;
  guessLimit: number;
  guessesLeft: number;
  /** Visible guess streak of the user (0 when logged out). */
  streak: number;
};

/**
 * remainingCodes over ALL clues of the active round (not only the ones sent) and the dials
 * opened by the drill, cached in `:left` (src/shared/codes-left.ts). A clue count fully
 * identifies the clue set of a round (board entries are append-only) and a drilled count the
 * opened dials (fixed order), so a hit is exact. ~25 ms typical, ~65 ms worst for the top
 * rung (README). Single-flight: on a miss only the winner of a short SET NX lock per version
 * computes; concurrent requests get the older value of the round (stale) or null at once.
 */
const loadCodesLeft = async (
  keys: Keys,
  spec: VaultSpec,
  meta: VaultMeta,
  drill: DrillView
): Promise<CodesLeftView> => {
  const want: CodesLeftVersion = {
    round: meta.round,
    clues: meta.guessCount - meta.roundStartSeq,
    drilled: drill.revealed.length,
  };
  if (want.clues === 0 && want.drilled === 0)
    return { codesLeft: codeSpaceSize(spec), stale: false };
  const cached = parseCodesLeft(await redis.get(keys.codesLeft));
  const plan = planCodesLeft(cached, want);
  if (plan.kind === 'hit') return plan.view;
  const won = await setNx(
    keys.codesLeftLock(codesLeftLockSuffix(want)),
    '1',
    CODES_LEFT_LOCK_SECONDS
  );
  if (!won) return fallbackCodesLeft(cached, want);
  const raw = await redis.zRange(
    keys.board,
    meta.roundStartSeq,
    meta.guessCount - 1,
    {
      by: 'rank',
    }
  );
  const clues: BoardEntry[] = [];
  for (const { member } of raw) {
    const entry = parseStoredBoardEntry(member);
    if (entry && entry.round === meta.round) clues.push(entry);
  }
  const left = remainingCodes(spec, clues, drill.revealed);
  await redis.set(keys.codesLeft, encodeCodesLeft({ ...want, value: left }), {
    expiration: ttlDate(),
  });
  return { codesLeft: left, stale: false };
};

const loadDeepest = async (
  subredditId: string,
  day: string
): Promise<DeepestRecord | null> => {
  const raw = await redis.hGet(subKeys(subredditId).deepest, day);
  if (raw === undefined) return null;
  const parsed = parseStoredDeepest(raw);
  if (!parsed) console.warn(`[vault] corrupt deepest record for ${day}`);
  return parsed;
};

/**
 * Public day state. Built from `:meta`, `:board`, `:cracks`, `:left`, `:guesses`, the
 * deepest-vault hash and the drill view; the active secret is read only inside loadDrill and
 * only its opened dials come out. Each guess adds exactly one board member and each
 * crack one cracks member, so the newest entries are fetched by rank from the known counts.
 */
export const loadVaultState = async (
  subredditId: string,
  day: string,
  userId: string | undefined
): Promise<PublicVaultState> => {
  const keys = vaultKeys(subredditId, day);
  const [meta, usedRaw, deepest, streakRaw] = await Promise.all([
    loadMeta(keys),
    userId ? redis.hGet(keys.guesses, userId) : Promise.resolve(undefined),
    loadDeepest(subredditId, day),
    userId
      ? redis.hGet(subKeys(subredditId).streak, userId)
      : Promise.resolve(undefined),
  ]);
  const spec = specFor(day, meta.round);
  const boardTotal = meta.guessCount - meta.roundStartSeq;
  const cracksTotal = meta.round - 1;
  const [boardRaw, cracksRaw] = await Promise.all([
    boardTotal > 0
      ? redis.zRange(
          keys.board,
          Math.max(meta.roundStartSeq, meta.guessCount - BOARD_SEND_LIMIT),
          meta.guessCount - 1,
          { by: 'rank' }
        )
      : Promise.resolve([]),
    cracksTotal > 0
      ? redis.zRange(
          keys.cracks,
          Math.max(0, cracksTotal - CRACKS_SEND_LIMIT),
          cracksTotal - 1,
          {
            by: 'rank',
          }
        )
      : Promise.resolve([]),
  ]);
  const board: BoardEntry[] = [];
  for (const { member } of boardRaw) {
    const entry = parseStoredBoardEntry(member);
    if (!entry)
      console.warn(`[vault] skipping corrupt board member in ${keys.board}`);
    else if (entry.round === meta.round) board.push(entry);
  }
  board.sort((a, b) => a.seq - b.seq);
  const cracks: CrackRecord[] = [];
  for (const { member } of cracksRaw) {
    const crack = parseStoredCrack(member);
    if (!crack)
      console.warn(`[vault] skipping corrupt crack member in ${keys.cracks}`);
    else cracks.push(crack);
  }
  cracks.sort((a, b) => a.round - b.round);
  const used = parseUsed(usedRaw);
  const drill = await loadDrill(keys, day, spec, meta);
  return {
    spec,
    meta,
    board,
    boardTotal,
    codesLeft: await loadCodesLeft(keys, spec, meta, drill),
    drill,
    cracks,
    cracksTotal,
    deepest,
    guessesUsed: used,
    guessLimit: GUESSES_PER_DAY,
    guessesLeft: guessesLeft(used),
    streak: visibleStreak(parseStreak(streakRaw), day),
  };
};

export type SubmitGuessResult =
  | {
      status: 'ok';
      result: GuessResult;
      /** Committed board entry and, on a crack, the closed round (public; for realtime). */
      entry: BoardEntry;
      crack: CrackRecord | null;
      /** Guesser's streak and all-time cracks after this guess (public leaderboard data). */
      cracker: { streak: number; cracks: number };
    }
  | { status: 'rejected'; code: GuessRejectCode; message: string };

type CommitPlan = Extract<GuessPlan, { ok: true }>;

const okResult = (
  plan: CommitPlan,
  cracker: { streak: number; cracks: number }
): SubmitGuessResult => ({
  status: 'ok',
  entry: plan.entry,
  crack: plan.crack,
  cracker,
  result: {
    guess: plan.entry.guess,
    exact: plan.feedback.exact,
    misplaced: plan.feedback.misplaced,
    cracked: plan.cracked,
    round: plan.entry.round,
  },
});

/** Whether the board already holds our entry (same seq and request id). */
const entryCommitted = async (
  keys: Keys,
  entry: BoardEntry
): Promise<boolean> => {
  const members = await redis.zRange(keys.board, entry.seq, entry.seq, {
    by: 'score',
  });
  return members.some(
    ({ member }) => parseStoredBoardEntry(member)?.id === entry.id
  );
};

/** Best effort: drop the WATCH (or the queued MULTI) before rethrowing. */
const release = async (tx: TxClient, inMulti: boolean): Promise<void> => {
  try {
    if (inMulti) await tx.discard();
    else await tx.unwatch();
  } catch (error) {
    console.warn('[guess] releasing transaction failed:', error);
  }
};

/**
 * Score and commit one guess. Optimistic concurrency: WATCH `:meta` and `:guesses`, decide
 * with planGuess, then MULTI/EXEC. If another guess commits in between, EXEC aborts and the
 * decision is retried on fresh data (with backoff), so the daily limit and the single
 * cracker per round hold under concurrent requests. Each request carries one random id; if
 * EXEC throws after committing, the id on the board prevents a second write.
 */
export const submitGuess = async (input: {
  subredditId: string;
  day: string;
  userId: string;
  username: string;
  /** Already validated against specFor(day, expectedRound). */
  digits: number[];
  expectedDay: string;
  expectedRound: number;
  accountOk: boolean;
}): Promise<SubmitGuessResult> => {
  const { subredditId, day, userId, username, digits } = input;
  const keys = vaultKeys(subredditId, day);
  const sub = subKeys(subredditId);
  const id = randomUUID();
  for (let attempt = 1; attempt <= GUESS_TX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(retryDelayMs(attempt - 1, Math.random));
    // `record` is watched too: it is compared and rewritten only in a crack transaction.
    const tx = await redis.watch(keys.meta, keys.guesses, sub.record);
    let meta: VaultMeta;
    let plan: GuessPlan;
    let streakJson: string;
    let cracker: { streak: number; cracks: number };
    let record: DeepestRecord | null;
    try {
      // Streak and crack count are read under the WATCH: a user's guesses all touch
      // `:guesses`, so two of them never commit from the same read.
      const [m, usedRaw, streakRaw, cracksRaw, recordRaw] = await Promise.all([
        loadMeta(keys),
        redis.hGet(keys.guesses, userId),
        redis.hGet(sub.streak, userId),
        redis.zScore(sub.crackCount, username),
        redis.get(sub.record),
      ]);
      meta = m;
      record = recordRaw ? parseStoredDeepest(recordRaw) : null;
      const streak = nextStreak(parseStreak(streakRaw), day);
      streakJson = JSON.stringify(streak);
      const priorCracks =
        cracksRaw !== undefined && Number.isInteger(cracksRaw) && cracksRaw > 0
          ? cracksRaw
          : 0;
      cracker = { streak: streak.count, cracks: priorCracks };
      // Spec of the round actually open; planGuess refuses a guess for another round as
      // stale before scoring, so `digits` always fit the spec they are scored against.
      const spec = specFor(day, meta.round);
      const secret = await loadSecret(keys, spec, meta.round);
      plan = planGuess({
        spec,
        meta,
        used: parseUsed(usedRaw),
        secret,
        digits,
        username,
        id,
        expectedDay: input.expectedDay,
        expectedRound: input.expectedRound,
        accountOk: input.accountOk,
        nowMs: Date.now(),
      });
    } catch (error) {
      await release(tx, false);
      throw error;
    }
    if (!plan.ok) {
      await release(tx, false);
      return { status: 'rejected', code: plan.code, message: plan.reason };
    }
    if (plan.crack) cracker = { ...cracker, cracks: cracker.cracks + 1 };

    let inMulti = false;
    try {
      await tx.multi();
      inMulti = true;
      await tx.hIncrBy(keys.guesses, userId, 1);
      await tx.hSet(keys.meta, metaToHash(plan.meta));
      await tx.zAdd(keys.board, {
        member: JSON.stringify(plan.entry),
        score: plan.entry.seq,
      });
      // Only committed guesses extend the streak (rejected / stale ones never get here).
      await tx.hSet(sub.streak, { [userId]: streakJson });
      const dayKeys = [keys.guesses, keys.meta, keys.board];
      if (plan.crack) {
        await tx.zAdd(keys.cracks, {
          member: JSON.stringify(plan.crack),
          score: plan.crack.round,
        });
        // Vault #N+1 starts right away with a fresh secret on the next ladder rung and its
        // own drill order; its drill clock starts at plan.meta.roundStartMs (= now).
        const nextSpec = specFor(day, plan.meta.round);
        await tx.set(keys.secret(plan.meta.round), newSecret(nextSpec), {
          expiration: ttlDate(),
        });
        await tx.set(
          keys.drill(plan.meta.round),
          newDrillOrder(nextSpec.dials),
          {
            expiration: ttlDate(),
          }
        );
        // Rounds are cracked in order, so this crack is the deepest of the day.
        const deepest: DeepestRecord = {
          day,
          round: plan.crack.round,
          username: plan.crack.username,
          atMs: plan.crack.atMs,
        };
        await tx.hSet(sub.deepest, { [day]: JSON.stringify(deepest) });
        // All-time safecrackers of the sub (no TTL) and the all-time deepest record.
        await tx.zIncrBy(sub.crackCount, plan.crack.username, 1);
        // A missing record (data older than the key) is left to the leaderboard's one-time
        // migration from the per-day hash, which already includes this crack.
        if (record && deepestOf([record, deepest]) === deepest)
          await tx.set(sub.record, JSON.stringify(deepest));
        await tx.del(sub.leaderboardCache);
        dayKeys.push(keys.cracks);
      }
      for (const key of dayKeys) await tx.expire(key, DAY_KEY_TTL_SECONDS);
    } catch (error) {
      await release(tx, inMulti);
      throw error;
    }

    let execResult: unknown;
    try {
      execResult = await tx.exec();
    } catch (error) {
      const [ownEntryOnBoard, guessCountNow] = await Promise.all([
        entryCommitted(keys, plan.entry),
        redis.hGet(keys.meta, 'guessCount'),
      ]);
      const outcome = execFailureOutcome({
        ownEntryOnBoard,
        metaChanged: guessCountNow !== String(meta.guessCount),
      });
      if (outcome === 'committed') {
        console.warn(`[guess] exec threw but guess ${id} is committed:`, error);
        return okResult(plan, cracker);
      }
      if (outcome === 'error') throw error;
      console.warn(
        `[guess] exec threw after ${keys.meta} changed, retrying:`,
        error
      );
      continue;
    }
    if (isExecAborted(execResult)) {
      console.warn(
        `[guess] WATCH conflict on ${keys.meta} (attempt ${attempt})`
      );
      continue;
    }
    return okResult(plan, cracker);
  }
  return {
    status: 'rejected',
    code: 'busy',
    message: 'too many people guessing at once, please retry',
  };
};
