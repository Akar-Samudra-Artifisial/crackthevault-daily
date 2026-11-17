import { context, reddit, redis } from '@devvit/web/server';
import { isExecAborted } from '../../shared/tx';
import { DAY_KEY_TTL_SECONDS, specFor } from '../../shared/vault';
import { dayKey, modCacheKey, vaultKeys } from './keys';

export type TimeInfo = {
  iso: string;
  timezoneOffsetMinutes: number;
  dayKey: string;
};

export const timeInfo = (): TimeInfo => {
  const now = new Date();
  return {
    iso: now.toISOString(),
    timezoneOffsetMinutes: now.getTimezoneOffset(),
    dayKey: dayKey(now),
  };
};

const POST_PENDING = 'pending';
/** Covers the rest of a UTC day, so a stuck "pending" marker cannot expire into a duplicate. */
const POST_PENDING_TTL_SECONDS = 26 * 60 * 60;
/** A "pending" marker older than this is stale: its creator most likely died. */
const POST_PENDING_STALE_MS = 5 * 60 * 1000;
const POST_MARKER_ATTEMPTS = 3;
const MOD_CACHE_TTL_SECONDS = 5 * 60;

export type DailyPostResult =
  | { status: 'created'; postId: string; time: TimeInfo }
  | { status: 'exists'; postId: string; time: TimeInfo }
  | { status: 'pending'; stale: boolean; time: TimeInfo };

const pendingMarker = (nowMs: number): string => `${POST_PENDING}:${nowMs}`;

/** Age of a "pending:<ms>" marker; null for a post id. */
const pendingAgeMs = (value: string, nowMs: number): number | null => {
  if (!value.startsWith(POST_PENDING)) return null;
  const at = Number.parseInt(value.slice(POST_PENDING.length + 1), 10);
  return Number.isFinite(at)
    ? Math.max(0, nowMs - at)
    : Number.POSITIVE_INFINITY;
};

/** Replace a stale marker with a fresh one, only if nobody else changed it meanwhile. */
const takeOverStaleMarker = async (
  key: string,
  seen: string,
  nowMs: number
): Promise<boolean> => {
  const tx = await redis.watch(key);
  if ((await redis.get(key)) !== seen) {
    await tx.unwatch();
    return false;
  }
  await tx.multi();
  await tx.set(key, pendingMarker(nowMs), {
    expiration: new Date(nowMs + POST_PENDING_TTL_SECONDS * 1000),
  });
  try {
    return !isExecAborted(await tx.exec());
  } catch (error) {
    console.warn(`[dailyPost] stale marker takeover on ${key} aborted:`, error);
    return false;
  }
};

/** SET NX with TTL; false when the key already exists. */
export const setNx = async (
  key: string,
  value: string,
  ttlSeconds: number
): Promise<boolean> => {
  try {
    const res = await redis.set(key, value, {
      nx: true,
      expiration: new Date(Date.now() + ttlSeconds * 1000),
    });
    return res === 'OK';
  } catch (error) {
    if (error instanceof Error && error.message.includes('redis: nil'))
      return false;
    throw error;
  }
};

/**
 * Create today's vault post at most once per subreddit per UTC day. A SET NX marker
 * ("pending:<ms>", then the post id) dedupes cron, install trigger and the mod menu.
 * With `forceStale` (mod menu) a marker pending for over 5 minutes is taken over.
 */
export const ensureDailyPost = async (
  source: string,
  options: { forceStale: boolean } = { forceStale: false }
): Promise<DailyPostResult> => {
  const t = timeInfo();
  const keys = vaultKeys(context.subredditId, t.dayKey);
  console.log(
    `[dailyPost] source=${source} sub=${context.subredditName} iso=${t.iso} day=${t.dayKey}`
  );

  const nowMs = Date.now();
  if (
    !(await setNx(keys.post, pendingMarker(nowMs), POST_PENDING_TTL_SECONDS))
  ) {
    const existing = await redis.get(keys.post);
    if (existing === undefined)
      return { status: 'pending', stale: false, time: t };
    const age = pendingAgeMs(existing, nowMs);
    if (age === null) return { status: 'exists', postId: existing, time: t };
    const stale = age > POST_PENDING_STALE_MS;
    if (!stale || !options.forceStale)
      return { status: 'pending', stale, time: t };
    if (!(await takeOverStaleMarker(keys.post, existing, nowMs))) {
      return { status: 'pending', stale: false, time: t };
    }
    console.warn(
      `[dailyPost] source=${source} took over stale marker "${existing}" for ${t.dayKey}`
    );
  }

  const spec = specFor(t.dayKey, 1);
  const date = `${t.dayKey.slice(0, 4)}-${t.dayKey.slice(4, 6)}-${t.dayKey.slice(6)}`;
  let postId: string;
  try {
    const post = await reddit.submitCustomPost({
      title: `Crack the Vault — ${spec.name} (${date})`,
    });
    postId = post.id;
  } catch (error) {
    // Nothing was created: free the marker so another trigger can retry.
    await redis.del(keys.post);
    throw error;
  }

  // The post exists now. Never delete the marker from here on: if storing the id fails,
  // the "pending" marker still blocks automatic duplicates; only a mod can force past it.
  for (let attempt = 1; attempt <= POST_MARKER_ATTEMPTS; attempt++) {
    try {
      await redis.set(keys.post, postId, {
        expiration: new Date(Date.now() + DAY_KEY_TTL_SECONDS * 1000),
      });
      break;
    } catch (error) {
      console.error(
        `[dailyPost] storing post id ${postId} failed (attempt ${attempt}):`,
        error
      );
    }
  }
  return { status: 'created', postId, time: t };
};

/** Moderator check (menu only; mods have no gameplay bypass), cached 5 minutes per user. */
export const isModerator = async (
  username: string | undefined
): Promise<boolean> => {
  if (!username) return false;
  const cacheKey = modCacheKey(context.subredditId, username);
  const cached = await redis.get(cacheKey);
  if (cached === '1' || cached === '0') return cached === '1';

  const mods = await reddit
    .getModerators({ subredditName: context.subredditName, username })
    .all();
  const isMod = mods.some(
    (m) => m.username.toLowerCase() === username.toLowerCase()
  );
  await redis.set(cacheKey, isMod ? '1' : '0', {
    expiration: new Date(Date.now() + MOD_CACHE_TTL_SECONDS * 1000),
  });
  return isMod;
};
