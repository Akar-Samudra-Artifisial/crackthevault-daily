import { realtime } from '@devvit/web/server';
import type { RealtimeEvent, StateResponse } from '../../shared/api';
import { drillEvent } from '../../shared/realtime';
import { DAY_KEY_TTL_SECONDS } from '../../shared/vault';
import { vaultKeys } from './keys';
import { setNx } from './post';

/**
 * Broadcast an event on the day's channel. Best effort: a failed publish is logged and never
 * fails the request (clients also refetch /api/state on their own).
 */
export const publishEvent = async (
  channel: string,
  event: RealtimeEvent
): Promise<void> => {
  try {
    await realtime.send<RealtimeEvent>(channel, event);
  } catch (error) {
    console.error(
      `[realtime] send ${event.type} #${event.round} on ${channel} failed:`,
      error
    );
  }
};

/**
 * The drill has no cron: the first request that sees a newly opened dial (count derived from
 * the clock) wins a SET NX marker per (round, count) and broadcasts a `drill` event, so idle
 * clients learn about it too. Never throws.
 */
export const announceDrill = async (
  subredditId: string,
  state: StateResponse
): Promise<void> => {
  const count = state.drill.revealed.length;
  if (count === 0) return;
  try {
    const marker = vaultKeys(subredditId, state.day).drillAnnounced(
      state.round,
      count
    );
    if (!(await setNx(marker, '1', DAY_KEY_TTL_SECONDS))) return;
  } catch (error) {
    console.error('[realtime] drill marker failed:', error);
    return;
  }
  await publishEvent(state.channel, drillEvent(state));
};
