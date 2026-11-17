// "X codes left" cache + single-flight decisions (pure; the server does the Redis calls).
//
// The cache key `:left` holds "round:clues:drilled:value". On a miss only the request that wins
// a short SET NX lock for that exact version computes remainingCodes (~25–65 ms on the top
// rung); the others answer at once with the older cached value of the same round, flagged
// stale (it is an upper bound: more clues and dials only remove codes), or null when there is
// none. Clients show "…"/"≤ X" and refetch shortly.

/** Which clue set + opened dials a codes-left value belongs to. */
export type CodesLeftVersion = {
  round: number;
  clues: number;
  drilled: number;
};

export type CodesLeftCache = CodesLeftVersion & { value: number };

/** What /api/state sends. */
export type CodesLeftView = { codesLeft: number | null; stale: boolean };

/** Seconds a compute lock lives: long enough for one remainingCodes, short if a worker dies. */
export const CODES_LEFT_LOCK_SECONDS = 5;

const CACHE_RE = /^(\d{1,9}):(\d{1,9}):(\d{1,2}):(\d{1,9})$/;

export const encodeCodesLeft = (c: CodesLeftCache): string =>
  `${c.round}:${c.clues}:${c.drilled}:${c.value}`;

export const parseCodesLeft = (
  raw: string | null | undefined
): CodesLeftCache | null => {
  const m = CACHE_RE.exec(raw ?? '');
  if (!m) return null;
  return {
    round: Number(m[1]),
    clues: Number(m[2]),
    drilled: Number(m[3]),
    value: Number(m[4]),
  };
};

/** Lock-key suffix: one compute per exact version. */
export const codesLeftLockSuffix = (v: CodesLeftVersion): string =>
  `${v.round}:${v.clues}:${v.drilled}`;

/** Cache hit (fresh value) or the need to compute. */
export const planCodesLeft = (
  cached: CodesLeftCache | null,
  want: CodesLeftVersion
): { kind: 'hit'; view: CodesLeftView } | { kind: 'compute' } =>
  cached &&
  cached.round === want.round &&
  cached.clues === want.clues &&
  cached.drilled === want.drilled
    ? { kind: 'hit', view: { codesLeft: cached.value, stale: false } }
    : { kind: 'compute' };

/**
 * Answer for a request that lost the compute lock: an older value of the same round (stale
 * upper bound) or null. A value of another round, or a "newer" one, is never reused.
 */
export const fallbackCodesLeft = (
  cached: CodesLeftCache | null,
  want: CodesLeftVersion
): CodesLeftView =>
  cached &&
  cached.round === want.round &&
  cached.clues <= want.clues &&
  cached.drilled <= want.drilled
    ? { codesLeft: cached.value, stale: true }
    : { codesLeft: null, stale: false };
