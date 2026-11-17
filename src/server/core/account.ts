import { reddit } from '@devvit/web/server';
import { accountOldEnough } from '../../shared/account';

/**
 * Account-age rule for the current user. No moderator exemption (mods play by the same
 * rules). Fail-open: when Reddit does not return the creation date the guess is allowed and
 * a warning is logged.
 */
export const accountMayGuess = async (): Promise<boolean> => {
  let createdAtMs: number | null = null;
  try {
    const user = await reddit.getCurrentUser();
    const ms = user?.createdAt.getTime();
    if (ms !== undefined && Number.isFinite(ms)) createdAtMs = ms;
  } catch (error) {
    console.warn('getCurrentUser failed:', error);
  }
  if (createdAtMs === null)
    console.warn('account age unknown, allowing the guess (fail-open)');
  return accountOldEnough(createdAtMs, Date.now());
};
