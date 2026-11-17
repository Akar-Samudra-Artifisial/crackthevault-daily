// Pure helpers for the guess transaction (retry, backoff, exec outcome). No runtime imports:
// unit tests load this file directly.

/**
 * Devvit's TxClient.exec() maps the reply list of EXEC to an array
 * (node_modules/@devvit/redis/RedisClient.js `exec()`): an EXEC aborted by WATCH has no
 * replies, so it comes back empty. A committed transaction always has at least one reply
 * because we queue at least one command.
 */
export const isExecAborted = (result: unknown): boolean =>
  !Array.isArray(result) || result.length === 0;

/** WATCH conflicts are retried this many times before answering "busy". */
export const GUESS_TX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 15;
const BACKOFF_JITTER_MS = 25;

/**
 * Delay before retry number `attempt` (1 = first retry): exponential 15·2^(n-1) ms plus up to
 * 25 ms jitter from `random` ([0, 1)). Sum over all 4 retries stays ≤ 325 ms.
 */
export const retryDelayMs = (attempt: number, random: () => number): number => {
  const n = Math.max(1, Math.floor(attempt));
  const r = Math.min(Math.max(random(), 0), 1);
  return BACKOFF_BASE_MS * 2 ** (n - 1) + Math.floor(r * BACKOFF_JITTER_MS);
};

export type ExecFailureOutcome = 'committed' | 'conflict' | 'error';

/**
 * EXEC threw. It may still have committed (e.g. the reply was lost), so a retry must never
 * write the guess twice:
 * - our own entry (unique id) is on the board → it committed, return that result;
 * - otherwise the day changed under us → a concurrent commit won, retry;
 * - otherwise nothing changed → a real error.
 */
export const execFailureOutcome = (input: {
  ownEntryOnBoard: boolean;
  metaChanged: boolean;
}): ExecFailureOutcome => {
  if (input.ownEntryOnBoard) return 'committed';
  if (input.metaChanged) return 'conflict';
  return 'error';
};
