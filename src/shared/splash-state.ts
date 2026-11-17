// Light /api/state reader for the feed splash. The splash shows a handful of fields, so it
// validates only those instead of pulling the full parser (src/shared/api.ts) into the small
// inline bundle. Pure, no runtime imports (unit tests load this file directly).

/** Escalation ladder rungs as `dials:maxDigit:unique`; must equal LEVEL_LADDER (vault.ts). */
export const TIER_KEYS: readonly string[] = [
  '3:4:0',
  '3:5:0',
  '4:5:0',
  '4:7:0',
  '4:9:0',
  '5:7:0',
  '5:9:0',
  '6:8:0',
  '6:9:0',
];

export type TierSpec = { dials: number; maxDigit: number; unique: boolean };

/** "Tier 9 of 9": the vault's rung on the ladder (1-based); "Tier ?" off the ladder. */
export const tierText = (spec: TierSpec): string => {
  const i = TIER_KEYS.indexOf(
    `${spec.dials}:${spec.maxDigit}:${spec.unique ? 1 : 0}`
  );
  return i < 0 ? 'Tier ?' : `Tier ${i + 1} of ${TIER_KEYS.length}`;
};

export type SplashState = {
  spec: TierSpec & { name: string };
  round: number;
  codesLeft: number | null;
  codesLeftStale: boolean;
  boardTotal: number;
  /** Last cracked vault of today, null before the first crack. */
  lastCrack: { round: number; username: string } | null;
  username: string | null;
  guessesUsed: number;
  guessesLeft: number;
  streak: number;
};

const USER_RE = /^[A-Za-z0-9_-]{1,32}$/;

const get = (v: unknown, k: string): unknown =>
  typeof v === 'object' && v !== null ? Reflect.get(v, k) : undefined;

const count = (v: unknown, k: string): number | null => {
  const n = get(v, k);
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
};

const lastCrackOf = (cracks: unknown): SplashState['lastCrack'] | undefined => {
  if (!Array.isArray(cracks)) return undefined;
  if (cracks.length === 0) return null;
  const last: unknown = cracks[cracks.length - 1];
  const round = count(last, 'round');
  const username = get(last, 'username');
  return round !== null &&
    typeof username === 'string' &&
    USER_RE.test(username)
    ? { round, username }
    : undefined;
};

/** /api/state body → the splash's fields; null when any of them is missing or malformed. */
export const parseSplashState = (value: unknown): SplashState | null => {
  if (get(value, 'status') !== 'ok') return null;
  const rawSpec = get(value, 'spec');
  const name = get(rawSpec, 'name');
  const dials = count(rawSpec, 'dials');
  const maxDigit = count(rawSpec, 'maxDigit');
  const unique = get(rawSpec, 'unique');
  const round = count(value, 'round');
  const rawCodes = get(value, 'codesLeft');
  const codesLeft = rawCodes === null ? null : count(value, 'codesLeft');
  const codesLeftStale = get(value, 'codesLeftStale');
  const boardTotal = count(value, 'boardTotal');
  const lastCrack = lastCrackOf(get(value, 'cracks'));
  const username = get(value, 'username');
  const guessesUsed = count(value, 'guessesUsed');
  const guessesLeft = count(value, 'guessesLeft');
  const streak = count(value, 'streak');
  if (
    typeof name !== 'string' ||
    name.length > 80 ||
    dials === null ||
    dials < 1 ||
    dials > 10 ||
    maxDigit === null ||
    maxDigit > 9 ||
    typeof unique !== 'boolean' ||
    round === null ||
    round < 1 ||
    (rawCodes !== null && codesLeft === null) ||
    typeof codesLeftStale !== 'boolean' ||
    boardTotal === null ||
    lastCrack === undefined ||
    (username !== null &&
      (typeof username !== 'string' || !USER_RE.test(username))) ||
    guessesUsed === null ||
    guessesLeft === null ||
    streak === null
  )
    return null;
  return {
    spec: { name, dials, maxDigit, unique },
    round,
    codesLeft,
    codesLeftStale,
    boardTotal,
    lastCrack,
    username,
    guessesUsed,
    guessesLeft,
    streak,
  };
};
