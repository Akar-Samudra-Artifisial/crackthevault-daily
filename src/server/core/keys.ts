/** UTC day key, e.g. 20261117. Cron and day boundaries are all UTC. */
export const dayKey = (date: Date = new Date()): string =>
  date.toISOString().slice(0, 10).replaceAll('-', '');

/** Per-subreddit, per-day keys. All get DAY_KEY_TTL_SECONDS when written. */
export const vaultKeys = (subredditId: string, day: string) => {
  const p = `v:${subredditId}:${day}`;
  return {
    /** Secret code of a round (digit string). Never sent to clients while active. */
    secret: (round: number) => `${p}:secret:${round}`,
    /** Drill opening order of a round's dials (position string, e.g. "2031"). Server-only. */
    drill: (round: number) => `${p}:drill:${round}`,
    /** SET NX marker: the drill event for (round, opened dials) was broadcast */
    drillAnnounced: (round: number, count: number) =>
      `${p}:drillpub:${round}:${count}`,
    /** epoch ms vault #1's secret was first created (drill clock of round 1); SET NX */
    firstStart: `${p}:start1`,
    /** short SET NX lock "one remainingCodes per version" (suffix round:clues:drilled) */
    codesLeftLock: (version: string) => `${p}:left:lock:${version}`,
    /** hash: round, guessCount, roundStartSeq, roundStartMs */
    meta: `${p}:meta`,
    /** zset JSON CrackRecord → round (written only when a vault is cracked) */
    cracks: `${p}:cracks`,
    /** string "round:clues:drilled:codesLeft" — cache of remainingCodes for the active round */
    codesLeft: `${p}:left`,
    /** zset JSON BoardEntry → seq (guess order of the day) */
    board: `${p}:board`,
    /** hash userId → guesses used today */
    guesses: `${p}:guesses`,
    /** daily post marker: "pending:<ms>" while creating, then the post id */
    post: `${p}:post`,
    /** SET NX marker: Safecracker flair handled for the crack of `round` (once per round) */
    flairDone: (round: number) => `${p}:reward:flair:${round}`,
    /** SET NX marker: app comment posted for the crack of `round` (once per round) */
    commentDone: (round: number) => `${p}:reward:comment:${round}`,
    /** hash "flair:N" / "comment:N" → failed attempts (retried from /api/state, max 3) */
    rewardRetry: `${p}:reward:retry`,
  };
};

/** Per-subreddit keys that outlive a day (no TTL). */
export const subKeys = (subredditId: string) => ({
  /** hash userId → JSON Streak (consecutive UTC days with a committed guess) */
  streak: `v:${subredditId}:streak`,
  /** zset username → vaults cracked all-time in this subreddit */
  crackCount: `v:${subredditId}:crackcount`,
  /** string "day:round:username" — who wears the Safecracker of the Day flair */
  flairHolder: `v:${subredditId}:safecracker`,
  /** hash username → JSON SavedFlair (flair worn before ours; restored when ours goes) */
  flairSaved: `v:${subredditId}:safecracker:saved`,
  /** hash username → failed attempts to take our flair away (retried on later rewards) */
  flairPendingRemoval: `v:${subredditId}:safecracker:pending`,
  /** short SET NX lock: one run over flairPendingRemoval at a time */
  flairPendingLock: `v:${subredditId}:safecracker:pending:lock`,
  /** JSON DeepestRecord — deepest vault ever cracked here (set in the crack transaction) */
  record: `v:${subredditId}:record`,
  /** hash day, round, size, body — /api/leaderboard public part, 15 s; deleted on a crack */
  leaderboardCache: `v:${subredditId}:lbcache`,
  /** hash day (yyyymmdd) → JSON DeepestRecord (deepest vault cracked that day; M3 leaderboard) */
  deepest: `v:${subredditId}:deepest`,
});

export const modCacheKey = (subredditId: string, username: string): string =>
  `v:${subredditId}:modcache:${username.toLowerCase()}`;
