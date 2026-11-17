import { reddit, redis } from '@devvit/web/server';
import type { T3 } from '@devvit/web/shared';
import { parseStoredCrack } from '../../shared/api';
import {
  REWARD_MAX_ATTEMPTS,
  SAFECRACKER_FLAIR_TEXT,
  crackComment,
  encodeFlairHolder,
  encodeSavedFlair,
  flairToSave,
  isSafecrackerFlair,
  mustRevokeAfterSet,
  parseFlairHolder,
  parseRewardRetryField,
  parseSavedFlair,
  pickPendingRemovals,
  planFlairClaim,
  planFlairRemoval,
  rewardRetryField,
  type FlairHolder,
  type RewardKind,
} from '../../shared/safecracker';
import { isExecAborted } from '../../shared/tx';
import {
  DAY_KEY_TTL_SECONDS,
  specFor,
  type CrackRecord,
} from '../../shared/vault';
import { subKeys, vaultKeys } from './keys';
import { setNx } from './post';

const POST_ID_RE = /^t3_[a-z0-9]+$/;
const COUNT_RE = /^\d{1,4}$/;
/** WATCH/MULTI attempts for the holder claim. */
const CLAIM_ATTEMPTS = 3;
/** Single-flight lock over the pending-removal queue. */
const PENDING_LOCK_SECONDS = 30;

const isPostId = (value: string | undefined): value is T3 =>
  value !== undefined && POST_ID_RE.test(value);

type Ctx = { subredditId: string; subredditName: string; day: string };

const readHolder = async (subredditId: string): Promise<FlairHolder | null> =>
  parseFlairHolder(await redis.get(subKeys(subredditId).flairHolder));

/**
 * Take our flair away from `username`: restore the flair they wore before (saved when ours
 * was set), remove it when they had none, leave it when they wear another flair by now (set
 * by them or a moderator). A failure queues them in `flairPendingRemoval` (retried on later
 * rewards) and is logged at error level; never throws.
 */
const takeFlairAway = async (ctx: Ctx, username: string): Promise<void> => {
  const sub = subKeys(ctx.subredditId);
  try {
    // They may hold it rightfully again (a later crack of theirs).
    if ((await readHolder(ctx.subredditId))?.username === username) {
      await redis.hDel(sub.flairPendingRemoval, [username]);
      return;
    }
    const user = await reddit.getUserByUsername(username);
    if (user) {
      const [current, savedRaw] = await Promise.all([
        user.getUserFlairBySubreddit(ctx.subredditName),
        redis.hGet(sub.flairSaved, username),
      ]);
      const plan = planFlairRemoval(
        current?.flairText,
        parseSavedFlair(savedRaw)
      );
      if (plan.kind === 'restore')
        await reddit.setUserFlair({
          subredditName: ctx.subredditName,
          username,
          text: plan.flair.text,
          ...(plan.flair.cssClass ? { cssClass: plan.flair.cssClass } : {}),
        });
      else if (plan.kind === 'remove')
        await reddit.removeUserFlair(ctx.subredditName, username);
    }
    await Promise.all([
      redis.hDel(sub.flairSaved, [username]),
      redis.hDel(sub.flairPendingRemoval, [username]),
    ]);
  } catch (error) {
    console.error(
      `[rewards] taking the flair from u/${username} failed (queued for retry):`,
      error
    );
    try {
      await redis.hIncrBy(sub.flairPendingRemoval, username, 1);
    } catch (queueError) {
      console.error(
        `[rewards] queueing flair removal of u/${username} failed:`,
        queueError
      );
    }
  }
};

/** Retry queued flair removals (single-flight per sub, bounded batch). Never throws. */
const retryPendingRemovals = async (ctx: Ctx): Promise<void> => {
  const sub = subKeys(ctx.subredditId);
  try {
    if (!(await setNx(sub.flairPendingLock, '1', PENDING_LOCK_SECONDS))) return;
    const [pending, holder] = await Promise.all([
      redis.hGetAll(sub.flairPendingRemoval),
      readHolder(ctx.subredditId),
    ]);
    const { retry, drop } = pickPendingRemovals(
      pending,
      holder?.username ?? null
    );
    if (drop.length > 0) {
      await redis.hDel(sub.flairPendingRemoval, drop);
      const exhausted = drop.filter((u) => u !== holder?.username);
      if (exhausted.length > 0)
        console.error(
          `[rewards] gave up taking the flair from: ${exhausted.join(', ')}`
        );
    }
    for (const username of retry) await takeFlairAway(ctx, username);
    await redis.del(sub.flairPendingLock);
  } catch (error) {
    console.error('[rewards] pending flair removals failed:', error);
  }
};

/**
 * Claim the holder for this crack under WATCH: written in the MULTI only when the crack is
 * newer than the stored holder, so two rewards never both become holder.
 */
const claimHolder = async (
  subredditId: string,
  crack: FlairHolder
): Promise<ReturnType<typeof planFlairClaim>> => {
  const key = subKeys(subredditId).flairHolder;
  for (let attempt = 1; attempt <= CLAIM_ATTEMPTS; attempt++) {
    const tx = await redis.watch(key);
    const plan = planFlairClaim(parseFlairHolder(await redis.get(key)), crack);
    if (plan.kind !== 'claim') {
      await tx.unwatch();
      return plan;
    }
    await tx.multi();
    await tx.set(key, encodeFlairHolder(crack));
    if (!isExecAborted(await tx.exec())) return plan;
  }
  throw new Error(`flair holder claim conflicted ${CLAIM_ATTEMPTS} times`);
};

/** Save the cracker's own flair (unless they wear ours already) and set ours. */
const giveFlair = async (ctx: Ctx, username: string): Promise<void> => {
  const sub = subKeys(ctx.subredditId);
  const user = await reddit.getUserByUsername(username);
  if (!user) throw new Error(`u/${username} not found`);
  const current = await user.getUserFlairBySubreddit(ctx.subredditName);
  if (!isSafecrackerFlair(current?.flairText)) {
    const save = flairToSave(current);
    if (save)
      await redis.hSet(sub.flairSaved, { [username]: encodeSavedFlair(save) });
    else await redis.hDel(sub.flairSaved, [username]);
  }
  await reddit.setUserFlair({
    subredditName: ctx.subredditName,
    username,
    text: SAFECRACKER_FLAIR_TEXT,
  });
};

/**
 * Flair for a crack: holder claimed atomically first, then Reddit. The previous holder's
 * flair is restored/removed (queued on failure); if a newer crack took the holder while we
 * set ours, ours is taken back. Throws when our flair could not be set (caller retries).
 */
const doFlair = async (ctx: Ctx, crack: CrackRecord): Promise<void> => {
  const ref: FlairHolder = {
    day: ctx.day,
    round: crack.round,
    username: crack.username,
  };
  const plan = await claimHolder(ctx.subredditId, ref);
  if (plan.kind === 'skip') return;
  const [give, take] = await Promise.allSettled([
    giveFlair(ctx, crack.username),
    plan.kind === 'claim' && plan.removeFrom
      ? takeFlairAway(ctx, plan.removeFrom)
      : Promise.resolve(),
  ]);
  if (take.status === 'rejected')
    console.error('[rewards] flair removal failed:', take.reason);
  if (give.status === 'rejected') throw give.reason;
  if (mustRevokeAfterSet(await readHolder(ctx.subredditId), ref))
    await takeFlairAway(ctx, crack.username);
};

const doComment = async (ctx: Ctx, crack: CrackRecord): Promise<void> => {
  const postId = await redis.get(vaultKeys(ctx.subredditId, ctx.day).post);
  // "pending:<ms>" (post still being created) or no post: retried later.
  if (!isPostId(postId)) throw new Error(`no post id for ${ctx.day} yet`);
  await reddit.submitComment({
    id: postId,
    text: crackComment(crack, specFor(ctx.day, crack.round).name),
  });
};

/**
 * One attempt of a reward under its SET NX marker (single-flight; done once per round). On
 * failure the marker is deleted and the failure counted in the day's retry hash, so
 * /api/state retries it (max REWARD_MAX_ATTEMPTS in total). Never throws.
 */
const attemptReward = async (
  ctx: Ctx,
  kind: RewardKind,
  crack: CrackRecord
): Promise<void> => {
  const keys = vaultKeys(ctx.subredditId, ctx.day);
  const marker =
    kind === 'flair'
      ? keys.flairDone(crack.round)
      : keys.commentDone(crack.round);
  const field = rewardRetryField(kind, crack.round);
  try {
    if (!(await setNx(marker, '1', DAY_KEY_TTL_SECONDS))) return;
  } catch (error) {
    console.error(`[rewards] ${field} marker failed:`, error);
    return;
  }
  try {
    if (kind === 'flair') await doFlair(ctx, crack);
    else await doComment(ctx, crack);
    await redis.hDel(keys.rewardRetry, [field]);
  } catch (error) {
    console.error(
      `[rewards] ${field} u/${crack.username} failed (will retry):`,
      error
    );
    try {
      await redis.del(marker);
      await redis.hIncrBy(keys.rewardRetry, field, 1);
      await redis.expire(keys.rewardRetry, DAY_KEY_TTL_SECONDS);
    } catch (cleanupError) {
      console.error(
        `[rewards] ${field} retry bookkeeping failed:`,
        cleanupError
      );
    }
  }
};

/**
 * Safecracker rewards after a committed crack: flair (moved from the previous holder) and an
 * app comment with the cracked (public) code, plus queued flair removals. Best effort: never
 * fails the guess. Only the closed round's CrackRecord is used, never the next vault's
 * secret. Awaited: the runtime is not documented to keep running after the response.
 */
export const rewardCrack = async (input: Ctx & { crack: CrackRecord }) => {
  const { crack, ...ctx } = input;
  await Promise.all([
    attemptReward(ctx, 'flair', crack),
    attemptReward(ctx, 'comment', crack),
  ]);
  await retryPendingRemovals(ctx);
};

/**
 * Retry failed rewards of today's cracked rounds (called from /api/state). Cheap when nothing
 * failed (one HGETALL of an empty key); each retry is single-flight via its marker and
 * stops after REWARD_MAX_ATTEMPTS failures. Never throws.
 */
export const retryFailedRewards = async (
  ctx: Ctx & { round: number }
): Promise<void> => {
  const keys = vaultKeys(ctx.subredditId, ctx.day);
  try {
    const failed = await redis.hGetAll(keys.rewardRetry);
    for (const [field, raw] of Object.entries(failed)) {
      const ref = parseRewardRetryField(field);
      if (!ref || ref.round >= ctx.round) continue;
      if (!COUNT_RE.test(raw) || Number(raw) >= REWARD_MAX_ATTEMPTS) continue;
      const [hit] = await redis.zRange(keys.cracks, ref.round, ref.round, {
        by: 'score',
      });
      const crack = hit ? parseStoredCrack(hit.member) : null;
      if (crack && crack.round === ref.round)
        await attemptReward(ctx, ref.kind, crack);
    }
  } catch (error) {
    console.error('[rewards] retrying failed rewards failed:', error);
  }
};
