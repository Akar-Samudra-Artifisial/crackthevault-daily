import { Hono } from 'hono';
import type { TaskResponse } from '@devvit/web/server';
import { parseTaskBody } from '../../shared/api';
import { ensureDailyPost } from '../core/post';

export const scheduler = new Hono();

scheduler.post('/daily-vault', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = null;
  }
  const name = parseTaskBody(raw)?.name ?? 'unknown-task';
  try {
    const result = await ensureDailyPost(`cron:${name}`);
    console.log(
      `[cron] ${name} ${result.status}${'postId' in result ? ` ${result.postId}` : ''} iso=${result.time.iso}`
    );
    return c.json<TaskResponse>({}, 200);
  } catch (error) {
    console.error(`[cron] ${name} failed to create post:`, error);
    return c.json<TaskResponse>({}, 500);
  }
});
