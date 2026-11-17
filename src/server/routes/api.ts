import { Hono } from 'hono';
import type { Context as HonoContext } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { context, reddit } from '@devvit/web/server';
import {
  parseGuessRequest,
  type ErrorResponse,
  type GuessResponse,
  type StateResponse,
} from '../../shared/api';
import { ACCOUNT_TOO_NEW_MESSAGE } from '../../shared/account';
import { isStaleDay, parseGuess, specFor } from '../../shared/vault';
import { accountMayGuess } from '../core/account';
import { dayKey } from '../core/keys';
import { guessEvent, vaultChannel } from '../../shared/realtime';
import { announceDrill, publishEvent } from '../core/realtime';
import { loadVaultState, submitGuess } from '../core/vault';

export const api = new Hono();

/** A guess body is tiny ({"guess":"01234","round":12}); anything bigger is refused. */
const MAX_GUESS_REQUEST_BYTES = 1024;

const errorJson = (
  c: HonoContext,
  message: string,
  status: 400 | 401 | 413 | 500
) => c.json<ErrorResponse>({ status: 'error', message }, status);

/** Unexpected failure: details stay in the server log, the client gets a generic message. */
const serverError = (c: HonoContext, route: string, error: unknown) => {
  console.error(`${route} failed:`, error);
  return errorJson(c, 'Something went wrong', 500);
};

api.use(
  '/guess',
  bodyLimit({
    maxSize: MAX_GUESS_REQUEST_BYTES,
    onError: (c) =>
      errorJson(
        c,
        `request body exceeds ${MAX_GUESS_REQUEST_BYTES} bytes`,
        413
      ),
  })
);

/**
 * Public state, assembled field by field from loadVaultState. The active code cannot leak:
 * its only trace is `drill.revealed`, built by revealDials (src/shared/drill.ts), which opens
 * at most dials − 1 digits (cracked codes are public by design).
 */
const buildState = async (
  day: string,
  username: string | null
): Promise<StateResponse> => {
  const s = await loadVaultState(context.subredditId, day, context.userId);
  const state: StateResponse = {
    status: 'ok',
    day,
    spec: s.spec,
    round: s.meta.round,
    totalGuesses: s.meta.guessCount,
    board: s.board,
    boardTotal: s.boardTotal,
    codesLeft: s.codesLeft.codesLeft,
    codesLeftStale: s.codesLeft.stale,
    drill: s.drill,
    channel: vaultChannel(context.subredditId, day),
    cracks: s.cracks,
    cracksTotal: s.cracksTotal,
    deepest: s.deepest,
    username,
    guessesUsed: s.guessesUsed,
    guessLimit: s.guessLimit,
    guessesLeft: s.guessesLeft,
    serverTime: new Date().toISOString(),
  };
  await announceDrill(context.subredditId, state);
  return state;
};

api.get('/state', async (c) => {
  try {
    const username = (await reddit.getCurrentUsername()) ?? null;
    return c.json<StateResponse>(await buildState(dayKey(), username));
  } catch (error) {
    return serverError(c, 'GET /api/state', error);
  }
});

api.post('/guess', async (c) => {
  const { subredditId, userId } = context;
  const username = await reddit.getCurrentUsername();
  if (!userId || !username) return errorJson(c, 'login required to guess', 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorJson(c, 'request body must be JSON', 400);
  }
  const req = parseGuessRequest(body);
  if (!req)
    return errorJson(
      c,
      'body must be {"guess": …, "day": "yyyymmdd", "round": <int ≥ 1>}',
      400
    );

  try {
    const day = dayKey();
    // Checked before parsing: yesterday's guess may not fit today's spec. Costs no guess.
    if (isStaleDay(req.day, day)) {
      return c.json<GuessResponse>({
        status: 'rejected',
        code: 'stale',
        message: `the vault of ${req.day} is closed; today is ${day}`,
        state: await buildState(day, username),
      });
    }
    // Validated against the vault the player was looking at; if another vault is open by
    // now, submitGuess refuses it as stale before scoring.
    const parsed = parseGuess(req.guess, specFor(day, req.round));
    if (!parsed.ok) {
      return c.json<GuessResponse>({
        status: 'rejected',
        code: 'invalid',
        message: parsed.reason,
        state: await buildState(day, username),
      });
    }
    const accountOk = await accountMayGuess();
    const outcome = await submitGuess({
      subredditId,
      day,
      userId,
      username,
      digits: parsed.digits,
      expectedDay: req.day,
      expectedRound: req.round,
      accountOk,
    });
    const state = await buildState(day, username);
    if (outcome.status === 'rejected') {
      return c.json<GuessResponse>({
        status: 'rejected',
        code: outcome.code,
        message:
          outcome.code === 'account'
            ? ACCOUNT_TOO_NEW_MESSAGE
            : outcome.message,
        state,
      });
    }
    // Committed: broadcast the public clue (and on a crack the closed round's code + next
    // spec). publishEvent logs and swallows failures, so the guess never fails here.
    await publishEvent(
      state.channel,
      guessEvent({
        state,
        entry: outcome.entry,
        crack: outcome.crack,
        nextSpec: outcome.crack ? specFor(day, outcome.crack.round + 1) : null,
      })
    );
    return c.json<GuessResponse>({
      status: 'ok',
      result: outcome.result,
      state,
    });
  } catch (error) {
    return serverError(c, 'POST /api/guess', error);
  }
});
