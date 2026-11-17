// Account rules for guessing (anti-sockpuppet). No runtime imports: unit tests load this file
// directly.

/** Accounts need to be at least this old to guess (fresh sockpuppets can't farm guesses). */
export const MIN_ACCOUNT_AGE_DAYS = 3;
export const ACCOUNT_TOO_NEW_MESSAGE = `Accounts must be at least ${MIN_ACCOUNT_AGE_DAYS} days old to guess`;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether an account created at `createdAtMs` may guess at `nowMs`. Unknown creation time
 * (null / not finite) is allowed: fail-open, so a Reddit API hiccup never blocks real players.
 */
export const accountOldEnough = (
  createdAtMs: number | null,
  nowMs: number,
  minDays: number = MIN_ACCOUNT_AGE_DAYS
): boolean => {
  if (createdAtMs === null || !Number.isFinite(createdAtMs)) return true;
  return nowMs - createdAtMs >= minDays * DAY_MS;
};
