// Ordering rules for the game client's copy of the vault state. Snapshots (/api/state, the state
// inside a guess response) and realtime events can arrive out of order; these merges make sure an
// older snapshot never removes clues or tries that the client already knows about.
// Only `import type` from other modules: unit tests load this file directly with `node --test`.
import type { RealtimeClue, StateResponse } from './api';
import type { BoardEntry } from './vault';

/** Same value as BOARD_SEND_LIMIT in vault.ts (a value import would break `node --test`). */
const BOARD_KEEP = 100;

/**
 * - `new-day`: next is a later UTC day (clean start, never a celebration).
 * - `new-round`: same day, later vault.
 * - `same`: same vault; board and counters merged.
 * - `older`: an earlier day or vault; ignored (state === prev).
 */
export type MergeKind = 'new-day' | 'new-round' | 'same' | 'older';

export type MergeResult = { kind: MergeKind; state: StateResponse };

const unionBoard = (a: BoardEntry[], b: BoardEntry[]): BoardEntry[] => {
  const bySeq = new Map<number, BoardEntry>();
  for (const e of a) bySeq.set(e.seq, e);
  for (const e of b) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((x, y) => x.seq - y.seq).slice(-BOARD_KEEP);
};

const withTries = (st: StateResponse, guessesUsed: number): StateResponse => ({
  ...st,
  guessesUsed,
  guessesLeft: Math.max(0, st.guessLimit - guessesUsed),
});

/** Merges a fresh snapshot into the state the client shows. Pure. */
export const mergeState = (prev: StateResponse | null, next: StateResponse): MergeResult => {
  if (!prev || next.day > prev.day) return { kind: 'new-day', state: next };
  if (next.day < prev.day) return { kind: 'older', state: prev };

  // Same UTC day: the user's tries only ever go up.
  const used = Math.max(prev.guessesUsed, next.guessesUsed);
  if (next.round < prev.round) return { kind: 'older', state: withTries(prev, used) };
  if (next.round > prev.round) return { kind: 'new-round', state: withTries(next, used) };

  const newer = next.totalGuesses >= prev.totalGuesses;
  const base = newer ? next : prev;
  const other = newer ? prev : next;
  const board = unionBoard(prev.board, next.board);
  const drill =
    other.drill.revealed.length > base.drill.revealed.length ? other.drill : base.drill;
  return {
    kind: 'same',
    state: withTries(
      {
        ...base,
        // Identity fields always come from the latest response.
        username: next.username,
        board,
        drill,
        totalGuesses: Math.max(prev.totalGuesses, next.totalGuesses),
        boardTotal: Math.max(prev.boardTotal, next.boardTotal, board.length),
      },
      used
    ),
  };
};

/** Adds a realtime clue of the shown vault to the board. Same object when it is a duplicate. */
export const appendClue = (st: StateResponse, clue: RealtimeClue): StateResponse => {
  if (clue.round !== st.round || st.board.some((e) => e.seq === clue.seq)) return st;
  const board = unionBoard(st.board, [{ id: `rt-${clue.seq}`, ...clue }]);
  return { ...st, board, boardTotal: Math.max(st.boardTotal, st.board.length + 1) };
};
