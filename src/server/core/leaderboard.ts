import { redis } from '@devvit/web/server';
import {
  parseLeaderboardResponse,
  parseStoredCrack,
  parseStoredDeepest,
} from '../../shared/api';
import {
  LEADERBOARD_CRACKERS,
  LEADERBOARD_TOP,
  buildLeaderboard,
  deepestOf,
  rankFromAscending,
  type LeaderboardResponse,
  type MyStanding,
} from '../../shared/safecracker';
import { parseStreak, visibleStreak } from '../../shared/streak';
import type { CrackRecord, DeepestRecord } from '../../shared/vault';
import { subKeys, vaultKeys } from './keys';

const META_ROUND_RE = /^\d{1,6}$/;
const COUNT_RE = /^\d{1,9}$/;

/** Public part of /api/leaderboard is cached this long per subreddit. */
const LEADERBOARD_CACHE_SECONDS = 15;

type PublicBoard = { board: LeaderboardResponse; size: number };

/**
 * All-time record from `v:{sub}:record` (kept by the crack transaction). Older data without it
 * is migrated once from the per-day hash (SET NX; the transaction overwrites it when deeper).
 */
const loadRecord = async (
  subredditId: string
): Promise<DeepestRecord | null> => {
  const sub = subKeys(subredditId);
  const raw = await redis.get(sub.record);
  if (raw) {
    const rec = parseStoredDeepest(raw);
    if (rec) return rec;
    console.warn(`[leaderboard] corrupt ${sub.record}, rebuilding it`);
    await redis.del(sub.record);
  }
  const all = await redis.hGetAll(sub.deepest);
  const best = deepestOf(
    Object.values(all)
      .map(parseStoredDeepest)
      .filter((r) => r !== null)
  );
  if (best) {
    try {
      // No TTL; NX so a concurrent crack transaction's (deeper) record is never replaced.
      await redis.set(sub.record, JSON.stringify(best), { nx: true });
    } catch (error) {
      console.warn(`[leaderboard] migrating ${sub.record} skipped:`, error);
    }
  }
  return best;
};

const readCache = async (
  subredditId: string,
  day: string,
  round: number
): Promise<PublicBoard | null> => {
  const c = await redis.hGetAll(subKeys(subredditId).leaderboardCache);
  if (
    c.day !== day ||
    c.round !== String(round) ||
    c.size === undefined ||
    !COUNT_RE.test(c.size) ||
    c.body === undefined
  )
    return null;
  let body: unknown;
  try {
    body = JSON.parse(c.body);
  } catch {
    return null;
  }
  const board = parseLeaderboardResponse(body);
  return board && board.day === day ? { board, size: Number(c.size) } : null;
};

const writeCache = async (
  subredditId: string,
  round: number,
  pb: PublicBoard
): Promise<void> => {
  const key = subKeys(subredditId).leaderboardCache;
  await redis.hSet(key, {
    day: pb.board.day,
    round: String(round),
    size: String(pb.size),
    body: JSON.stringify(pb.board),
  });
  await redis.expire(key, LEADERBOARD_CACHE_SECONDS);
};

/** Shared (not per-user) part: today, record, crackers, top 10 and the zset size. */
const loadPublic = async (
  subredditId: string,
  day: string,
  round: number
): Promise<PublicBoard> => {
  const sub = subKeys(subredditId);
  const keys = vaultKeys(subredditId, day);
  const cracksTotal = Math.max(0, round - 1);
  const [todayRaw, record, topRaw, size, cracksRaw] = await Promise.all([
    redis.hGet(sub.deepest, day),
    loadRecord(subredditId),
    redis.zRange(sub.crackCount, 0, LEADERBOARD_TOP - 1, {
      by: 'rank',
      reverse: true,
    }),
    redis.zCard(sub.crackCount),
    cracksTotal > 0
      ? redis.zRange(
          keys.cracks,
          Math.max(0, cracksTotal - LEADERBOARD_CRACKERS),
          cracksTotal - 1,
          { by: 'rank' }
        )
      : Promise.resolve([]),
  ]);
  const today = todayRaw ? parseStoredDeepest(todayRaw) : null;
  const cracks: CrackRecord[] = [];
  for (const { member } of cracksRaw) {
    const crack = parseStoredCrack(member);
    if (crack) cracks.push(crack);
    else console.warn(`[leaderboard] skipping corrupt crack in ${keys.cracks}`);
  }
  return {
    board: buildLeaderboard({
      day,
      today: today && today.day === day ? today : null,
      allDays: record ? [record] : [],
      cracks,
      cracksTotal,
      top: topRaw,
      me: null,
    }),
    size,
  };
};

/**
 * Leaderboard of a subreddit for `day`: today's deepest + all-time record, today's newest
 * crackers, top safecrackers (cached 15 s per sub, keyed by day + open round, dropped by a
 * crack) and the caller's standing (always fresh). Every list is capped.
 */
export const loadLeaderboard = async (input: {
  subredditId: string;
  day: string;
  userId: string | undefined;
  username: string | null;
}): Promise<LeaderboardResponse> => {
  const { subredditId, day, userId, username } = input;
  const sub = subKeys(subredditId);
  const roundRaw = await redis.hGet(vaultKeys(subredditId, day).meta, 'round');
  const round =
    roundRaw !== undefined && META_ROUND_RE.test(roundRaw)
      ? Number(roundRaw)
      : 1;
  const [cached, myScore, myAscRank, streakRaw] = await Promise.all([
    readCache(subredditId, day, round),
    username
      ? redis.zScore(sub.crackCount, username)
      : Promise.resolve(undefined),
    username
      ? redis.zRank(sub.crackCount, username)
      : Promise.resolve(undefined),
    userId ? redis.hGet(sub.streak, userId) : Promise.resolve(undefined),
  ]);
  let pb = cached;
  if (!pb) {
    pb = await loadPublic(subredditId, day, round);
    try {
      await writeCache(subredditId, round, pb);
    } catch (error) {
      console.warn('[leaderboard] cache write failed:', error);
    }
  }
  const myCracks =
    myScore !== undefined && Number.isInteger(myScore) && myScore > 0
      ? myScore
      : 0;
  const me: MyStanding | null = username
    ? {
        username,
        cracks: myCracks,
        rank: myCracks > 0 ? rankFromAscending(myAscRank, pb.size) : null,
        streak: visibleStreak(parseStreak(streakRaw), day),
      }
    : null;
  return { ...pb.board, me };
};
