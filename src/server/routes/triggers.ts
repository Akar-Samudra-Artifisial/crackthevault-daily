import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { ensureDailyPost } from '../core/post';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const result = await ensureDailyPost('on-app-install');
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Daily post in ${context.subredditName}: ${result.status}${'postId' in result ? ` ${result.postId}` : ''}`,
      },
      200
    );
  } catch (error) {
    console.error('Error creating post:', error);
    return c.json<TriggerResponse>(
      { status: 'error', message: 'Failed to create post' },
      400
    );
  }
});
