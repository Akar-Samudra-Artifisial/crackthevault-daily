// Realtime channel name + event builders. Pure, `import type` only (unit tests load this file).
// Events are built only from public data: the post-commit StateResponse (which carries just the
// drill's opened dials), the committed board entry and the closed round's CrackRecord.
import type {
  ActiveVault,
  RealtimeClue,
  RealtimeEvent,
  StateResponse,
} from './api';
import type { BoardEntry, CrackRecord, VaultSpec } from './vault';

/**
 * `vault_{sub}_{day}` with every character other than letters, digits and `_` replaced by `_`:
 * connectRealtime refuses anything else
 * (node_modules/@devvit/realtime/client/realtime.js:37).
 */
export const vaultChannel = (subredditId: string, day: string): string =>
  `vault_${subredditId}_${day}`.replace(/[^A-Za-z0-9_]/g, '_');

export const activeVault = (s: StateResponse): ActiveVault => ({
  round: s.round,
  spec: { ...s.spec },
  totalGuesses: s.totalGuesses,
  boardTotal: s.boardTotal,
  codesLeft: s.codesLeft,
  codesLeftStale: s.codesLeftStale,
  drill: {
    revealed: s.drill.revealed.map((r) => ({ dial: r.dial, digit: r.digit })),
    nextDrillAt: s.drill.nextDrillAt,
    intervalMs: s.drill.intervalMs,
  },
});

const toClue = (e: BoardEntry): RealtimeClue => ({
  seq: e.seq,
  round: e.round,
  username: e.username,
  guess: [...e.guess],
  exact: e.exact,
  misplaced: e.misplaced,
});

/**
 * Event for a committed guess. `state` is the public state read after the commit (it may
 * already include later guesses: `active` describes the vault open now). `nextSpec` is the
 * spec of vault #crack.round + 1, required when `crack` is set.
 */
export const guessEvent = (input: {
  state: StateResponse;
  entry: BoardEntry;
  crack: CrackRecord | null;
  nextSpec: VaultSpec | null;
}): RealtimeEvent => {
  const { state, entry, crack, nextSpec } = input;
  const clue = toClue(entry);
  const active = activeVault(state);
  if (crack && nextSpec)
    return {
      type: 'cracked',
      day: state.day,
      round: crack.round,
      clue,
      crack: { ...crack, code: [...crack.code] },
      nextSpec: { ...nextSpec },
      active,
      // Rounds are cracked in order: this crack was the day's deepest when it happened.
      deepest: {
        day: state.day,
        round: crack.round,
        username: crack.username,
        atMs: crack.atMs,
      },
    };
  return {
    type: 'clue',
    day: state.day,
    round: entry.round,
    clue,
    active,
    deepest: state.deepest,
  };
};

export const drillEvent = (state: StateResponse): RealtimeEvent => ({
  type: 'drill',
  day: state.day,
  round: state.round,
  active: activeVault(state),
});
