import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, reddit } from '@devvit/web/server';
import { ensureDailyPost, isModerator } from '../core/post';

export const menu = new Hono();

const postUrl = (postId: string) =>
  `https://reddit.com/r/${context.subredditName}/comments/${postId}`;

menu.post('/post-create', async (c) => {
  try {
    // The menu item is mod-only in devvit.json; checked again here (defense in depth).
    const username = await reddit.getCurrentUsername();
    if (!(await isModerator(username))) {
      return c.json<UiResponse>(
        { showToast: "Only moderators can create today's vault" },
        403
      );
    }
    const result = await ensureDailyPost('menu', { forceStale: true });
    if (result.status === 'pending') {
      return c.json<UiResponse>({
        showToast:
          "Today's vault is being created; if it does not appear, try again in 5 minutes",
      });
    }
    return c.json<UiResponse>({
      showToast:
        result.status === 'created'
          ? 'Vault created'
          : "Today's vault already exists — opening it",
      navigateTo: postUrl(result.postId),
    });
  } catch (error) {
    console.error('Error creating post:', error);
    return c.json<UiResponse>(
      { showToast: "Couldn't create today's vault, please try again" },
      400
    );
  }
});
