// Vault rules: spec per (day, vault), code-breaking clues, guess parsing, daily guess limit.
// Pure, no runtime imports: unit tests load this file directly with `node --test`.

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export type VaultSpec = {
  /** UTC day, yyyymmdd. */
  day: string;
  /** 0 = Sunday … 6 = Saturday (UTC). */
  weekday: number;
  /** Vault number within the day (1-based); later vaults are harder. */
  round: number;
  name: string;
  difficulty: Difficulty;
  /** Number of dials (code length). */
  dials: number;
  /** Highest digit on a dial; digits run 0..maxDigit. */
  maxDigit: number;
  /** When true, the secret and every guess use each digit at most once. */
  unique: boolean;
};

export type Feedback = {
  /** Right digit, right dial (🟢). */
  exact: number;
  /** Right digit, other dial (🟡). */
  misplaced: number;
};

/** One guess on the shared clue board. */
export type BoardEntry = {
  /** Random id of the guess request (dedupes a retried transaction). */
  id: string;
  /** 1-based order of the guess within the day (all rounds). */
  seq: number;
  round: number;
  username: string;
  guess: number[];
  exact: number;
  misplaced: number;
};

/** A cracked vault (round) of the day. The code is public once cracked. */
export type CrackRecord = {
  round: number;
  username: string;
  code: number[];
  /** Guesses made in that round, including the cracking one. */
  guesses: number;
  atMs: number;
};

/**
 * Deepest vault cracked in a subreddit on a day and who cracked it (vaults are cracked in
 * order, so it is the latest crack). Kept per subreddit per day for the M3 leaderboard.
 */
export type DeepestRecord = {
  day: string;
  round: number;
  username: string;
  atMs: number;
};

/**
 * Per-day state stored in the `:meta` hash (never contains a secret). Cracked rounds live in
 * their own `:cracks` zset so this hash stays a few bytes.
 */
export type VaultMeta = {
  /** Active round (vault number), starting at 1. Cracked rounds today = round - 1. */
  round: number;
  /** Guesses made today across all rounds. */
  guessCount: number;
  /** guessCount at the moment the active round started. */
  roundStartSeq: number;
  /** Epoch ms the active round started (crack of the previous one); 0 = 00:00 UTC of the day. */
  roundStartMs: number;
};

/** Clue board entries of the active round sent by /api/state (newest kept). */
export const BOARD_SEND_LIMIT = 100;
/** Cracked vaults sent by /api/state (newest kept). */
export const CRACKS_SEND_LIMIT = 20;

/** Guesses per player per UTC day, across all rounds. Moderators included. */
export const GUESSES_PER_DAY = 3;

/** Every per-day key expires after 8 days. */
export const DAY_KEY_TTL_SECONDS = 8 * 24 * 60 * 60;

const DAY_RE = /^\d{8}$/;

/** Code shape of one rung of the escalation ladder. */
export type VaultLevel = Pick<VaultSpec, 'dials' | 'maxDigit' | 'unique'>;

/**
 * Escalation ladder, strictly growing code space (125 → 1 000 000), capped at the top rung
 * (6 dials, 0–9: the most a phone UI holds). See `specFor`; tuned with `npm run sim`.
 */
export const LEVEL_LADDER: readonly (VaultLevel & { name: string })[] = [
  { name: 'Brass Strongbox', dials: 3, maxDigit: 4, unique: false }, //       125
  { name: 'Iron Safe', dials: 3, maxDigit: 5, unique: false }, //             216
  { name: 'Steel Safe', dials: 4, maxDigit: 5, unique: false }, //          1 296
  { name: 'Bank Vault', dials: 4, maxDigit: 7, unique: false }, //          4 096
  { name: 'Titanium Vault', dials: 4, maxDigit: 9, unique: false }, //     10 000
  { name: 'Royal Treasury', dials: 5, maxDigit: 7, unique: false }, //     32 768
  { name: "Dragon's Hoard", dials: 5, maxDigit: 9, unique: false }, //    100 000
  { name: 'Diamond Reserve', dials: 6, maxDigit: 8, unique: false }, //   531 441
  { name: 'Obsidian Citadel', dials: 6, maxDigit: 9, unique: false }, // 1 000 000
];

/** Rung of vault #1 on every weekday: easy enough that a 10-player crowd cracks it. */
export const FIRST_VAULT_RUNG = 0;

type WeekdayRule = {
  difficulty: Difficulty;
  /** LEVEL_LADDER index of vault #2 (easy 1 … expert 4); later vaults climb one rung each. */
  second: number;
};

/** Index = UTC weekday (0 = Sunday). */
const WEEKDAY_RULES: readonly WeekdayRule[] = [
  { difficulty: 'expert', second: 4 },
  { difficulty: 'easy', second: 1 },
  { difficulty: 'easy', second: 1 },
  { difficulty: 'medium', second: 2 },
  { difficulty: 'medium', second: 2 },
  { difficulty: 'hard', second: 3 },
  { difficulty: 'expert', second: 4 },
];

/** LEVEL_LADDER index of vault #`round` for a weekday rule (capped at the top rung). */
const rungFor = (rule: WeekdayRule, round: number): number =>
  round === 1
    ? FIRST_VAULT_RUNG
    : Math.min(rule.second + round - 2, LEVEL_LADDER.length - 1);

/** Number of valid codes of a spec/level. */
export const codeSpaceSize = (level: VaultLevel): number => {
  const base = level.maxDigit + 1;
  if (!level.unique) return base ** level.dials;
  let n = 1;
  for (let i = 0; i < level.dials; i++) n *= base - i;
  return n;
};

export const isDayKey = (day: string): boolean => {
  if (!DAY_RE.test(day)) return false;
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(4, 6));
  const d = Number(day.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
};

/**
 * Rules of vault #`round` on a UTC day (yyyymmdd), deterministic from (day, round). Vault #1
 * is the same easy rung every day; from vault #2 the weekday decides how high the day jumps
 * (easy rung 1 … expert rung 4) and each later vault climbs one rung.
 */
export const specFor = (day: string, round: number): VaultSpec => {
  if (!isDayKey(day)) throw new Error(`invalid day key "${day}"`);
  if (!Number.isInteger(round) || round < 1)
    throw new Error(`invalid round ${round}`);
  const weekday = new Date(
    Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(4, 6)) - 1,
      Number(day.slice(6, 8))
    )
  ).getUTCDay();
  const rule = WEEKDAY_RULES[weekday];
  if (!rule) throw new Error(`no vault rule for weekday ${weekday}`);
  const level = LEVEL_LADDER[rungFor(rule, round)];
  if (!level) throw new Error(`no ladder rung for round ${round}`);
  return {
    day,
    weekday,
    round,
    // The vault is named after its ladder rung, so a harder vault never reuses an easier name.
    name: level.name,
    difficulty: rule.difficulty,
    dials: level.dials,
    maxDigit: level.maxDigit,
    unique: level.unique,
  };
};

/**
 * Code-breaking clue for a guess: how many digits sit on the right dial (🟢) and how many
 * more are in the code on another dial (🟡). Counts only, never which dial. Correct for
 * repeated digits in the secret and/or the guess.
 */
export const scoreGuess = (
  secret: readonly number[],
  guess: readonly number[]
): Feedback => {
  if (secret.length !== guess.length)
    throw new Error(
      `guess length ${guess.length} does not match secret length ${secret.length}`
    );
  let exact = 0;
  const secretLeft = new Map<number, number>();
  const guessLeft = new Map<number, number>();
  for (let i = 0; i < secret.length; i++) {
    const s = secret[i];
    const g = guess[i];
    if (s === undefined || g === undefined) continue;
    if (s === g) {
      exact++;
    } else {
      secretLeft.set(s, (secretLeft.get(s) ?? 0) + 1);
      guessLeft.set(g, (guessLeft.get(g) ?? 0) + 1);
    }
  }
  let misplaced = 0;
  for (const [digit, count] of guessLeft) {
    misplaced += Math.min(count, secretLeft.get(digit) ?? 0);
  }
  return { exact, misplaced };
};

export const isCracked = (spec: VaultSpec, feedback: Feedback): boolean =>
  feedback.exact === spec.dials;

/** A dial opened by the drill: its position (0-based) and digit. */
export type DialReveal = { dial: number; digit: number };

/** A public clue: a guess and its 🟢/🟡 counts (BoardEntry fits). */
export type Clue = {
  guess: readonly number[];
  exact: number;
  misplaced: number;
};

/**
 * How many codes of `spec` are consistent with every clue ("X codes left"). Uses only public
 * data, so it is safe to show. Exact full enumeration of the code space (≤ 1 000 000 codes
 * for the top rung) with an odometer + running digit counts and early exit on the first
 * clue a code breaks; see README for timings. Clues that do not fit the spec are ignored.
 * Dials opened by the drill (`revealed`) must hold their digit.
 */
export const remainingCodes = (
  spec: VaultLevel,
  clues: readonly Clue[],
  revealed: readonly DialReveal[] = []
): number => {
  const k = spec.dials;
  const base = spec.maxDigit + 1;
  const fixed = revealed.filter(
    (r) => r.dial >= 0 && r.dial < k && r.digit >= 0 && r.digit <= spec.maxDigit
  );
  // Repeated guesses carry no new information: keep one clue per distinct (guess, feedback).
  const seenClues = new Set<string>();
  const valid = clues.filter((c) => {
    if (
      c.guess.length !== k ||
      !c.guess.every((d) => Number.isInteger(d) && d >= 0 && d <= spec.maxDigit)
    )
      return false;
    const key = `${c.guess.join('')}:${c.exact}:${c.misplaced}`;
    if (seenClues.has(key)) return false;
    seenClues.add(key);
    return true;
  });
  if (valid.length === 0 && fixed.length === 0) return codeSpaceSize(spec);
  // Per clue: guess digits, guess digit counts, distinct guess digits, expected sum.
  const n = valid.length;
  const gDigits = new Int8Array(n * k);
  const gCounts = new Int8Array(n * 10);
  const distinct: number[][] = [];
  const wantExact = new Int8Array(n);
  const wantCommon = new Int8Array(n);
  valid.forEach((c, i) => {
    const seen = new Set<number>();
    c.guess.forEach((d, p) => {
      gDigits[i * k + p] = d;
      gCounts[i * 10 + d] = (gCounts[i * 10 + d] ?? 0) + 1;
      seen.add(d);
    });
    distinct.push([...seen]);
    wantExact[i] = c.exact;
    wantCommon[i] = c.exact + c.misplaced;
  });
  const code = new Int8Array(k);
  const counts = new Int8Array(10);
  counts[0] = k;
  let repeats = k > 1 ? 1 : 0; // digits that occur more than once (for unique specs)
  let left = 0;
  const total = base ** k;
  for (let idx = 0; idx < total; idx++) {
    if (!spec.unique || repeats === 0) {
      let ok = true;
      for (const r of fixed) {
        if (code[r.dial] !== r.digit) {
          ok = false;
          break;
        }
      }
      for (let i = 0; i < n && ok; i++) {
        let exact = 0;
        const off = i * k;
        for (let p = 0; p < k; p++) if (code[p] === gDigits[off + p]) exact++;
        if (exact !== wantExact[i]) {
          ok = false;
          break;
        }
        let common = 0;
        for (const d of distinct[i] ?? [])
          common += Math.min(counts[d] ?? 0, gCounts[i * 10 + d] ?? 0);
        if (common !== wantCommon[i]) ok = false;
      }
      if (ok) left++;
    }
    // Odometer step (last dial fastest), keeping digit counts and repeat count in sync.
    for (let p = k - 1; p >= 0; p--) {
      const old = code[p] ?? 0;
      const next = old + 1 === base ? 0 : old + 1;
      code[p] = next;
      const oc = (counts[old] ?? 0) - 1;
      counts[old] = oc;
      if (oc === 1) repeats--;
      const nc = (counts[next] ?? 0) + 1;
      counts[next] = nc;
      if (nc === 2) repeats++;
      if (next !== 0) break;
    }
  }
  return left;
};

export type ParseGuessResult =
  { ok: true; digits: number[] } | { ok: false; reason: string };

/**
 * Validate an untrusted guess against the day's spec. Accepts a digit string ("0427") or an
 * array of integers ([0, 4, 2, 7]).
 */
export const parseGuess = (
  value: unknown,
  spec: VaultSpec
): ParseGuessResult => {
  let raw: unknown[];
  if (typeof value === 'string') {
    if (!/^\d*$/.test(value))
      return { ok: false, reason: 'guess may only contain digits' };
    raw = [...value].map(Number);
  } else if (Array.isArray(value)) {
    raw = value;
  } else {
    return {
      ok: false,
      reason: 'guess must be a digit string or an array of digits',
    };
  }
  if (raw.length !== spec.dials)
    return {
      ok: false,
      reason: `guess must have exactly ${spec.dials} digits`,
    };
  const digits: number[] = [];
  for (const d of raw) {
    if (
      typeof d !== 'number' ||
      !Number.isInteger(d) ||
      d < 0 ||
      d > spec.maxDigit
    )
      return { ok: false, reason: `each digit must be 0–${spec.maxDigit}` };
    digits.push(d);
  }
  if (spec.unique && new Set(digits).size !== digits.length)
    return { ok: false, reason: 'no digit may repeat in this vault' };
  return { ok: true, digits };
};

/** Random integer in [0, maxExclusive); the server passes node:crypto randomInt. */
export type RandomInt = (maxExclusive: number) => number;

/** A fresh secret for `spec`. Uniform as long as `randomInt` is. */
export const generateSecret = (
  spec: VaultSpec,
  randomInt: RandomInt
): number[] => {
  const draw = (maxExclusive: number): number => {
    const n = randomInt(maxExclusive);
    if (!Number.isInteger(n) || n < 0 || n >= maxExclusive)
      throw new Error(`randomInt(${maxExclusive}) returned ${n}`);
    return n;
  };
  const pool = Array.from({ length: spec.maxDigit + 1 }, (_, i) => i);
  const code: number[] = [];
  for (let i = 0; i < spec.dials; i++) {
    if (spec.unique) {
      const [picked] = pool.splice(draw(pool.length), 1);
      if (picked === undefined) throw new Error('digit pool exhausted');
      code.push(picked);
    } else {
      code.push(draw(spec.maxDigit + 1));
    }
  }
  return code;
};

export const encodeCode = (digits: readonly number[]): string =>
  digits.join('');

/** Stored code → digits, or null when it does not fit the spec (corrupt / other day). */
export const decodeCode = (
  raw: string | undefined | null,
  spec: VaultSpec
): number[] | null => {
  if (typeof raw !== 'string') return null;
  const parsed = parseGuess(raw, spec);
  return parsed.ok ? parsed.digits : null;
};

export type GuessDecision =
  { ok: true; remainingAfter: number } | { ok: false; reason: string };

/** Daily limit check (no moderator bypass): the 4th guess of a day is refused. */
export const guessDecision = (
  used: number,
  limit: number = GUESSES_PER_DAY
): GuessDecision => {
  if (!Number.isInteger(used) || used < 0)
    return { ok: false, reason: `invalid guess count ${used}` };
  if (used >= limit)
    return { ok: false, reason: `you already used all ${limit} guesses today` };
  return { ok: true, remainingAfter: limit - used - 1 };
};

/** Guesses left for a user that has used `used` today (never negative). */
export const guessesLeft = (
  used: number,
  limit: number = GUESSES_PER_DAY
): number => Math.max(0, limit - Math.max(0, used));

export type PlanRejectCode = 'account' | 'limit' | 'stale';

export type GuessPlan =
  | { ok: false; code: PlanRejectCode; reason: string }
  | {
      ok: true;
      entry: BoardEntry;
      feedback: Feedback;
      cracked: boolean;
      /** Set when this guess cracked the vault (store it in the `:cracks` zset). */
      crack: CrackRecord | null;
      /** Meta to store when the guess commits. */
      meta: VaultMeta;
      remainingAfter: number;
    };

/**
 * Whether a request made for `requestDay` must be refused as stale on `today` (both yyyymmdd).
 * Checked before the guess is parsed (yesterday's spec may differ) and costs no guess.
 */
export const isStaleDay = (requestDay: string, today: string): boolean =>
  requestDay !== today;

/**
 * Decide a guess against the (watched) day state. Pure: the server runs it inside the
 * WATCH/MULTI transaction, so the limit and "one cracker per round" hold under concurrency.
 */
export const planGuess = (input: {
  spec: VaultSpec;
  meta: VaultMeta;
  /** Guesses this user already made today. */
  used: number;
  secret: readonly number[];
  digits: readonly number[];
  username: string;
  /** Unique id of this guess request. */
  id: string;
  /** Day and round the client was looking at. */
  expectedDay: string;
  expectedRound: number;
  accountOk: boolean;
  nowMs: number;
}): GuessPlan => {
  const { spec, meta, secret, digits } = input;
  if (!input.accountOk)
    return { ok: false, code: 'account', reason: 'account too new to guess' };
  if (isStaleDay(input.expectedDay, spec.day))
    return {
      ok: false,
      code: 'stale',
      reason: `the vault of ${input.expectedDay} is closed; today is ${spec.day}`,
    };
  const limit = guessDecision(input.used);
  if (!limit.ok) return { ok: false, code: 'limit', reason: limit.reason };
  if (input.expectedRound !== meta.round)
    return {
      ok: false,
      code: 'stale',
      reason: `vault #${input.expectedRound} is closed; vault #${meta.round} is open now`,
    };
  const feedback = scoreGuess(secret, digits);
  const cracked = isCracked(spec, feedback);
  const seq = meta.guessCount + 1;
  const entry: BoardEntry = {
    id: input.id,
    seq,
    round: meta.round,
    username: input.username,
    guess: [...digits],
    exact: feedback.exact,
    misplaced: feedback.misplaced,
  };
  const crack: CrackRecord | null = cracked
    ? {
        round: meta.round,
        username: input.username,
        code: [...secret],
        guesses: seq - meta.roundStartSeq,
        atMs: input.nowMs,
      }
    : null;
  const next: VaultMeta = cracked
    ? {
        round: meta.round + 1,
        guessCount: seq,
        roundStartSeq: seq,
        roundStartMs: input.nowMs,
      }
    : { ...meta, guessCount: seq };
  return {
    ok: true,
    entry,
    feedback,
    cracked,
    crack,
    meta: next,
    remainingAfter: limit.remainingAfter,
  };
};

/** VaultMeta → `:meta` hash fields. */
export const metaToHash = (meta: VaultMeta): Record<string, string> => ({
  round: String(meta.round),
  guessCount: String(meta.guessCount),
  roundStartSeq: String(meta.roundStartSeq),
  roundStartMs: String(meta.roundStartMs),
});

export const EMPTY_META: VaultMeta = {
  round: 1,
  guessCount: 0,
  roundStartSeq: 0,
  roundStartMs: 0,
};

const strictInt = (raw: string | undefined): number | null => {
  if (raw === undefined || !/^\d{1,9}$/.test(raw)) return null;
  return Number(raw);
};

export type ParseMetaResult =
  { ok: true; meta: VaultMeta } | { ok: false; reason: string };

/**
 * `:meta` hash (HGETALL) → VaultMeta. An empty hash is a fresh day. A non-empty hash with a
 * missing or invalid field is corrupt and is refused (never silently reset: that would
 * reopen vault #1 and reuse its secret).
 */
export const parseMetaHash = (
  hash: Record<string, string>
): ParseMetaResult => {
  if (Object.keys(hash).length === 0) return { ok: true, meta: EMPTY_META };
  const round = strictInt(hash['round']);
  const guessCount = strictInt(hash['guessCount']);
  const roundStartSeq = strictInt(hash['roundStartSeq']);
  if (
    round === null ||
    round < 1 ||
    guessCount === null ||
    roundStartSeq === null
  )
    return { ok: false, reason: `invalid meta fields ${JSON.stringify(hash)}` };
  if (roundStartSeq > guessCount)
    return {
      ok: false,
      reason: `roundStartSeq ${roundStartSeq} > guessCount ${guessCount}`,
    };
  // Optional: hashes written before the drill existed lack it (0 = start of the day).
  const startRaw = hash['roundStartMs'];
  const roundStartMs =
    startRaw === undefined
      ? 0
      : /^\d{1,15}$/.test(startRaw)
        ? Number(startRaw)
        : null;
  if (roundStartMs === null)
    return { ok: false, reason: `invalid roundStartMs ${startRaw ?? ''}` };
  return { ok: true, meta: { round, guessCount, roundStartSeq, roundStartMs } };
};
