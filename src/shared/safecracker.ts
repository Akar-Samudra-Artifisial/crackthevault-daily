// Safecracker rewards + leaderboard (pure; `import type` only, unit tests load this file).
// Everything here is built from public data: cracked rounds' records (code included, public
// once cracked), deepest records, crack counts and streaks. Never an active secret.
import type { CrackRecord, DeepestRecord } from './vault';

export const SAFECRACKER_FLAIR_TEXT = 'Safecracker of the Day 🔓';

/** Whether a user's current flair is still ours (a flair set by a mod or the user is kept). */
export const isSafecrackerFlair = (text: string | null | undefined): boolean =>
  (text ?? '').trim() === SAFECRACKER_FLAIR_TEXT;

/**
 * Escape text for a Reddit markdown comment: `&`, `<`, `>` become HTML entities (no raw HTML
 * or entity tricks), markdown control characters and `@` get a backslash (usernames may
 * contain `_`; no mention/format injection).
 */
export const escapeMarkdown = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]()#|~^@]/g, '\\$&');

/**
 * App comment on the day's post for a cracked vault: "u/X cracked vault #N (<name>) in K
 * guesses 🔓" + the (now public) code of that vault. Only the closed round's record goes in.
 */
export const crackComment = (crack: CrackRecord, vaultName: string): string =>
  `u/${escapeMarkdown(crack.username)} cracked vault #${crack.round} ` +
  `(${escapeMarkdown(vaultName)}) in ${crack.guesses} ` +
  `${crack.guesses === 1 ? 'guess' : 'guesses'} 🔓\n\n` +
  `The code was \`${crack.code.join('')}\`. Vault #${crack.round + 1} is open now.`;

/** Holder of the flair in a subreddit, with the crack that earned it. */
export type FlairHolder = { username: string; day: string; round: number };

/**
 * Username charset/length, the same pattern as USERNAME_RE in src/shared/api.ts (a test keeps
 * them equal): every valid Reddit name (3–20 of `[A-Za-z0-9_-]`) passes, with headroom.
 */
export const USERNAME_PATTERN = '[A-Za-z0-9_-]{1,32}';

const HOLDER_RE = new RegExp(`^(\\d{8}):(\\d{1,6}):(${USERNAME_PATTERN})$`);

export const encodeFlairHolder = (h: FlairHolder): string =>
  `${h.day}:${h.round}:${h.username}`;

export const parseFlairHolder = (
  raw: string | null | undefined
): FlairHolder | null => {
  const [, day, round, username] = HOLDER_RE.exec(raw ?? '') ?? [];
  return day && round && username
    ? { day, round: Number(round), username }
    : null;
};

type CrackRef = { day: string; round: number; username: string };

/** (day, round) order: true when `a` was cracked after `b`. */
export const crackedAfter = (
  a: { day: string; round: number },
  b: { day: string; round: number }
): boolean => a.day > b.day || (a.day === b.day && a.round > b.round);

const sameCrack = (a: CrackRef, b: CrackRef): boolean =>
  a.day === b.day && a.round === b.round && a.username === b.username;

/**
 * Holder claim for a crack, decided on the holder read under WATCH (the server writes the new
 * holder in the same MULTI, so only a newer crack ever becomes holder):
 * - `claim`: this crack is newer than the holder → write it as holder, set the flair and take
 *   it from `removeFrom` (a different previous holder);
 * - `retry`: this crack already is the holder (an earlier attempt claimed it but setting the
 *   flair failed) → set the flair again, nothing to take;
 * - `skip`: a later crack already holds it (rewards of quick cracks may run out of order).
 */
export const planFlairClaim = (
  holder: FlairHolder | null,
  crack: CrackRef
):
  | { kind: 'claim'; removeFrom: string | null }
  | { kind: 'retry' }
  | { kind: 'skip' } => {
  if (holder && sameCrack(holder, crack)) return { kind: 'retry' };
  if (holder && !crackedAfter(crack, holder)) return { kind: 'skip' };
  return {
    kind: 'claim',
    removeFrom:
      holder && holder.username !== crack.username ? holder.username : null,
  };
};

/**
 * After our setUserFlair: if the holder in Redis is by now a later crack of someone else, the
 * flair we just set is outdated → take it back from the cracker.
 */
export const mustRevokeAfterSet = (
  holderNow: FlairHolder | null,
  crack: CrackRef
): boolean =>
  holderNow !== null &&
  holderNow.username !== crack.username &&
  crackedAfter(holderNow, crack);

/** A user's flair before we set ours (restored when ours is taken away). */
export type SavedFlair = { text: string; cssClass: string };

/** Reddit allows 64 characters of user flair text. */
const FLAIR_TEXT_MAX = 64;
const CSS_CLASS_RE = /^[A-Za-z0-9_ -]{0,100}$/;

export const encodeSavedFlair = (f: SavedFlair): string => JSON.stringify(f);

export const parseSavedFlair = (
  raw: string | null | undefined
): SavedFlair | null => {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const text: unknown = Reflect.get(value, 'text');
  const cssClass: unknown = Reflect.get(value, 'cssClass');
  if (
    typeof text !== 'string' ||
    text.length > FLAIR_TEXT_MAX ||
    typeof cssClass !== 'string' ||
    !CSS_CLASS_RE.test(cssClass)
  )
    return null;
  return { text, cssClass };
};

/**
 * What to keep of a user's current flair before ours replaces it: null when they wear ours
 * already (keep the earlier saved one) or have none; otherwise text + CSS class. A flair set
 * by a moderator cannot be told apart from one the user picked, so both are saved & restored.
 */
export const flairToSave = (
  current:
    | { flairText?: string | undefined; flairCssClass?: string | undefined }
    | undefined
): SavedFlair | null => {
  const text = (current?.flairText ?? '').slice(0, FLAIR_TEXT_MAX);
  const cssClass = current?.flairCssClass ?? '';
  if (isSafecrackerFlair(text)) return null;
  if (text.trim() === '' && cssClass.trim() === '') return null;
  return { text, cssClass: CSS_CLASS_RE.test(cssClass) ? cssClass : '' };
};

/**
 * Taking our flair away from a user: leave it when they no longer wear ours (changed since by
 * the user or a moderator), restore the saved flair, or remove it when there was none.
 */
export const planFlairRemoval = (
  currentText: string | null | undefined,
  saved: SavedFlair | null
):
  | { kind: 'keep' }
  | { kind: 'restore'; flair: SavedFlair }
  | { kind: 'remove' } => {
  if (!isSafecrackerFlair(currentText)) return { kind: 'keep' };
  return saved ? { kind: 'restore', flair: saved } : { kind: 'remove' };
};

/** Failed flair removals retried on later rewards; dropped after this many attempts. */
export const FLAIR_REMOVAL_MAX_ATTEMPTS = 5;
/** Pending removals retried per reward (bounded Reddit calls per guess). */
export const FLAIR_REMOVAL_BATCH = 3;
/** Attempts per (day, round, flair|comment) reward before giving up. */
export const REWARD_MAX_ATTEMPTS = 3;

/**
 * Which queued flair removals (username → failed attempts) to try now: never the current
 * holder (they wear it rightfully again → drop), drop corrupt or exhausted entries, retry at
 * most `batch` others.
 */
export const pickPendingRemovals = (
  pending: Readonly<Record<string, string>>,
  holder: string | null,
  batch: number = FLAIR_REMOVAL_BATCH
): { retry: string[]; drop: string[] } => {
  const retry: string[] = [];
  const drop: string[] = [];
  for (const [username, raw] of Object.entries(pending)) {
    const attempts = /^\d{1,4}$/.test(raw) ? Number(raw) : Number.NaN;
    if (
      username === holder ||
      !USERNAME_RE.test(username) ||
      !(attempts < FLAIR_REMOVAL_MAX_ATTEMPTS)
    )
      drop.push(username);
    else if (retry.length < batch) retry.push(username);
  }
  return { retry, drop };
};

export type RewardKind = 'flair' | 'comment';

/** Field of the day's retry hash: "flair:3" / "comment:3". */
export const rewardRetryField = (kind: RewardKind, round: number): string =>
  `${kind}:${round}`;

export const parseRewardRetryField = (
  field: string
): { kind: RewardKind; round: number } | null => {
  const m = /^(flair|comment):(\d{1,6})$/.exec(field);
  if (!m || (m[1] !== 'flair' && m[1] !== 'comment') || !m[2]) return null;
  const round = Number(m[2]);
  return round >= 1 ? { kind: m[1], round } : null;
};

/** Top safecrackers sent by /api/leaderboard. */
export const LEADERBOARD_TOP = 10;
/** Today's crackers sent by /api/leaderboard (newest). */
export const LEADERBOARD_CRACKERS = 20;

export type SafecrackerRow = { rank: number; username: string; cracks: number };

export type MyStanding = {
  username: string;
  /** All-time cracks in this subreddit. */
  cracks: number;
  /** 1-based position among all safecrackers; null with no crack yet. */
  rank: number | null;
  /** Visible guess streak (consecutive UTC days with a guess). */
  streak: number;
};

export type LeaderboardResponse = {
  status: 'ok';
  day: string;
  /** Deepest vault cracked today (null: none yet). */
  today: DeepestRecord | null;
  /** Deepest vault ever cracked in this subreddit (earliest wins a tie). */
  record: DeepestRecord | null;
  /** Newest ≤ LEADERBOARD_CRACKERS cracks of today, oldest first; total in crackersTotal. */
  crackers: CrackRecord[];
  crackersTotal: number;
  /** ≤ LEADERBOARD_TOP rows, most cracks first. */
  top: SafecrackerRow[];
  /** null when logged out. */
  me: MyStanding | null;
};

const USERNAME_RE = new RegExp(`^${USERNAME_PATTERN}$`);

/** Deepest of all days: highest round, then the earliest crack. */
export const deepestOf = (
  records: readonly DeepestRecord[]
): DeepestRecord | null => {
  let best: DeepestRecord | null = null;
  for (const r of records)
    if (
      !best ||
      r.round > best.round ||
      (r.round === best.round && r.atMs < best.atMs)
    )
      best = r;
  return best;
};

/**
 * Leaderboard from raw reads. `top` is the zset slice most-cracks-first; corrupt members are
 * skipped and every list is capped, so the response size is bounded.
 */
export const buildLeaderboard = (input: {
  day: string;
  today: DeepestRecord | null;
  allDays: readonly DeepestRecord[];
  /** Newest cracks of today (any number; capped here). */
  cracks: readonly CrackRecord[];
  /** Vaults cracked today (meta.round − 1). */
  cracksTotal: number;
  top: readonly { member: string; score: number }[];
  me: MyStanding | null;
}): LeaderboardResponse => {
  const crackers = [...input.cracks]
    .sort((a, b) => a.round - b.round)
    .slice(-LEADERBOARD_CRACKERS);
  const top: SafecrackerRow[] = [];
  for (const { member, score } of input.top) {
    if (top.length >= LEADERBOARD_TOP) break;
    if (!USERNAME_RE.test(member) || !Number.isInteger(score) || score < 1)
      continue;
    top.push({ rank: top.length + 1, username: member, cracks: score });
  }
  return {
    status: 'ok',
    day: input.day,
    today: input.today,
    record: deepestOf(
      input.today ? [...input.allDays, input.today] : input.allDays
    ),
    crackers,
    crackersTotal: Math.max(input.cracksTotal, crackers.length),
    top,
    me: input.me,
  };
};

/**
 * 1-based position of a member in a zset read most-first, from its ascending zRank and the
 * zset size (Redis orders ties by member, the same order the top list uses).
 */
export const rankFromAscending = (
  ascRank: number | undefined,
  size: number
): number | null =>
  ascRank === undefined || ascRank < 0 || ascRank >= size
    ? null
    : size - ascRank;
