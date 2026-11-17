import {
  parseErrorResponse,
  parseGuessResponse,
  parseLeaderboardResponse,
  parseStateResponse,
  type GuessRequest,
  type GuessResponse,
  type StateResponse,
} from '../shared/api';
import type { LeaderboardResponse } from '../shared/safecracker';

/** GET /api/state, validated with the shared parser. */
export const fetchState = async (): Promise<StateResponse> => {
  const res = await fetch('/api/state');
  const body: unknown = await res.json();
  const state = parseStateResponse(body);
  if (state) return state;
  const error = parseErrorResponse(body);
  throw new Error(
    error ? error.message : `unexpected /api/state response (${res.status})`
  );
};

/** GET /api/leaderboard, validated with the shared parser. */
export const fetchLeaderboard = async (): Promise<LeaderboardResponse> => {
  const res = await fetch('/api/leaderboard');
  const body: unknown = await res.json();
  const board = parseLeaderboardResponse(body);
  if (board) return board;
  const error = parseErrorResponse(body);
  throw new Error(
    error
      ? error.message
      : `unexpected /api/leaderboard response (${res.status})`
  );
};

/** POST /api/guess for the day and round the player is looking at. */
export const postGuess = async (
  state: StateResponse,
  guess: string
): Promise<GuessResponse> => {
  const request: GuessRequest = { guess, day: state.day, round: state.round };
  const res = await fetch('/api/guess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const body: unknown = await res.json();
  const parsed = parseGuessResponse(body);
  if (parsed) return parsed;
  const error = parseErrorResponse(body);
  throw new Error(
    error ? error.message : `unexpected /api/guess response (${res.status})`
  );
};
