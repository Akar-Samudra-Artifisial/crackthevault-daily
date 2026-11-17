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
  };
};

/** Per-subreddit keys that outlive a day. */
export const subKeys = (subredditId: string) => ({
  /** hash userId → JSON Streak (M3) */
  streak: `v:${subredditId}:streak`,
  /** hash day (yyyymmdd) → JSON DeepestRecord (deepest vault cracked that day; M3 leaderboard) */
  deepest: `v:${subredditId}:deepest`,
});

export const modCacheKey = (subredditId: string, username: string): string =>
  `v:${subredditId}:modcache:${username.toLowerCase()}`;
