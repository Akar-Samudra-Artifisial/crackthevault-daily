import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StateResponse } from '../src/shared/api.ts';
import {
  appendClue,
  applyRealtimeClue,
  mergeState,
  OWN_SEQS_LIMIT,
  rememberOwnSeqs,
} from '../src/shared/client-state.ts';
import { specFor, type BoardEntry } from '../src/shared/vault.ts';

const DAY = '20261117';
const NEXT_DAY = '20261118';

const entry = (seq: number, round = 3): BoardEntry => ({
  id: `req-${seq}`,
  seq,
  round,
  username: seq % 2 ? 'alice' : 'bob',
  guess: [1, 2, 3, 4],
  exact: 1,
  misplaced: 1,
});

const snap = (over: Partial<StateResponse> = {}): StateResponse => ({
  status: 'ok',
  day: DAY,
  spec: specFor(DAY, 3),
  round: 3,
  totalGuesses: 12,
  board: [entry(10), entry(11), entry(12)],
  boardTotal: 3,
  codesLeft: 216,
  codesLeftStale: false,
  drill: {
    revealed: [],
    nextDrillAt: 1_763_366_400_000,
    intervalMs: 21_600_000,
  },
  channel: 'vault_t5_abc_20261117',
  cracks: [],
  cracksTotal: 2,
  deepest: null,
  username: 'alice',
  guessesUsed: 1,
  guessLimit: 3,
  guessesLeft: 2,
  streak: 1,
  serverTime: '2026-11-17T10:00:00.000Z',
  ...over,
});

const seqs = (st: StateResponse): number[] => st.board.map((e) => e.seq);

test('first snapshot is taken as a new day', () => {
  const next = snap();
  const r = mergeState(null, next);
  assert.equal(r.kind, 'new-day');
  assert.equal(r.state, next);
});

test('an older snapshot of the same vault never removes realtime clues', () => {
  // Client already saw clue 13 over realtime; then a slow /api/state from before it lands.
  const shown = appendClue(snap(), { ...entry(13), round: 3 });
  const live = { ...shown, totalGuesses: 13, boardTotal: 4, codesLeft: 90 };
  const late = snap({ codesLeft: 216 });
  const r = mergeState(live, late);
  assert.equal(r.kind, 'same');
  assert.deepEqual(seqs(r.state), [10, 11, 12, 13]);
  assert.equal(r.state.totalGuesses, 13);
  assert.equal(r.state.boardTotal, 4);
  assert.equal(r.state.codesLeft, 90, 'counters come from the newer side');
});

test('a newer snapshot wins counters and the board is a seq-deduped union', () => {
  const shown = snap({
    board: [entry(10), entry(11), entry(13)],
    totalGuesses: 13,
  });
  const fresh = snap({
    board: [entry(11), entry(12), entry(13), entry(14)],
    totalGuesses: 14,
    boardTotal: 5,
    codesLeft: 40,
  });
  const r = mergeState(shown, fresh);
  assert.deepEqual(seqs(r.state), [10, 11, 12, 13, 14]);
  assert.equal(r.state.codesLeft, 40);
  assert.equal(r.state.boardTotal, 5);
});

test('own guess response: tries left follow the highest guessesUsed of the day', () => {
  // Own guess response says 2 used; a late snapshot (1 used) must not give a try back.
  const afterGuess = snap({ guessesUsed: 2, guessesLeft: 1, totalGuesses: 13 });
  const late = snap({ guessesUsed: 1, guessesLeft: 2, totalGuesses: 12 });
  const r = mergeState(afterGuess, late);
  assert.equal(r.state.guessesUsed, 2);
  assert.equal(r.state.guessesLeft, 1);
  // …and the response to the user's own guess always lowers tries even if counters lag.
  const r2 = mergeState(late, snap({ guessesUsed: 3, totalGuesses: 12 }));
  assert.equal(r2.state.guessesLeft, 0);
});

test('a later vault replaces the board; an earlier vault is ignored', () => {
  const shown = snap();
  const nextVault = snap({
    round: 4,
    spec: specFor(DAY, 4),
    board: [entry(20, 4)],
    totalGuesses: 20,
  });
  const up = mergeState(shown, nextVault);
  assert.equal(up.kind, 'new-round');
  assert.deepEqual(seqs(up.state), [20]);

  const back = mergeState(up.state, shown);
  assert.equal(back.kind, 'older');
  assert.equal(back.state.round, 4);
  assert.deepEqual(seqs(back.state), [20]);
});

test('UTC day change: newer day starts clean, older day is ignored', () => {
  const today = snap({ guessesUsed: 3, guessesLeft: 0 });
  const tomorrow = snap({
    day: NEXT_DAY,
    round: 1,
    spec: specFor(NEXT_DAY, 1),
    board: [],
    boardTotal: 0,
    totalGuesses: 0,
    guessesUsed: 0,
    guessesLeft: 3,
  });
  const r = mergeState(today, tomorrow);
  assert.equal(r.kind, 'new-day');
  assert.equal(r.state.guessesLeft, 3, 'tries reset with the day');
  assert.equal(mergeState(r.state, today).kind, 'older');
});

test('drill keeps the side with more opened dials', () => {
  const opened = snap({
    drill: {
      revealed: [{ dial: 0, digit: 3 }],
      nextDrillAt: 2,
      intervalMs: 21_600_000,
    },
  });
  const r = mergeState(opened, snap({ totalGuesses: 13 }));
  assert.equal(r.state.drill.revealed.length, 1);
});

test('board union keeps only the newest 100 clues', () => {
  const many = Array.from({ length: 100 }, (_, i) => entry(i + 1));
  const r = mergeState(
    snap({ board: many, boardTotal: 100, totalGuesses: 100 }),
    snap({ board: [entry(101)], boardTotal: 101, totalGuesses: 101 })
  );
  assert.equal(r.state.board.length, 100);
  assert.equal(r.state.board[0]?.seq, 2);
  assert.equal(r.state.board.at(-1)?.seq, 101);
});

test('appendClue dedupes by seq and skips other vaults', () => {
  const st = snap();
  const clue = {
    seq: 13,
    round: 3,
    username: 'bob',
    guess: [0, 1, 2, 3],
    exact: 0,
    misplaced: 2,
  };
  const once = appendClue(st, clue);
  assert.deepEqual(seqs(once), [10, 11, 12, 13]);
  assert.equal(once.boardTotal, 4);
  assert.equal(appendClue(once, clue), once);
  assert.equal(appendClue(st, { ...clue, round: 2 }), st);
});

test('own clue from another tab uses a try once, never below 0', () => {
  // Tab B shows 2 tries left (1 used); the player guesses in tab A → clue seq 13 as alice.
  const st = snap({ guessesUsed: 1, guessesLeft: 2 });
  const mine = {
    seq: 13,
    round: 3,
    username: 'alice',
    guess: [0, 1, 2, 3],
    exact: 0,
    misplaced: 2,
  };
  const { state: after, own } = applyRealtimeClue(st, mine);
  assert.deepEqual(seqs(after), [10, 11, 12, 13]);
  assert.equal(after.guessesUsed, 2);
  assert.equal(after.guessesLeft, 1);
  // Same clue again (event replay, or this tab's own guess response came first): no change.
  assert.equal(applyRealtimeClue(after, mine, own).state, after);
  // At the limit it stays at 0.
  const out = snap({ guessesUsed: 3, guessesLeft: 0 });
  const still = applyRealtimeClue(out, { ...mine, seq: 14 }).state;
  assert.equal(still.guessesLeft, 0);
  assert.equal(still.guessesUsed, 3);
  // A later snapshot with the server's count keeps it (max within the day).
  assert.equal(
    mergeState(after, snap({ guessesUsed: 2 })).state.guessesLeft,
    1
  );
});

test('realtime clues of other players or a logged-out viewer use no try', () => {
  const st = snap({ guessesUsed: 1, guessesLeft: 2 });
  const bob = {
    seq: 13,
    round: 3,
    username: 'bob',
    guess: [1, 1, 1, 1],
    exact: 1,
    misplaced: 0,
  };
  assert.equal(applyRealtimeClue(st, bob).state.guessesLeft, 2);
  const anon = snap({ username: null, guessesUsed: 0, guessesLeft: 3 });
  assert.equal(
    applyRealtimeClue(anon, { ...bob, username: 'alice' }).state.guessesLeft,
    3
  );
  // Other vault: ignored entirely.
  assert.equal(
    applyRealtimeClue(st, { ...bob, username: 'alice', round: 2 }).state,
    st
  );
});

test('own clue cut from the 100-clue board is not counted again on replay', () => {
  const mine = {
    seq: 13,
    round: 3,
    username: 'alice',
    guess: [0, 1, 2, 3],
    exact: 0,
    misplaced: 2,
  };
  const st = snap({ guessesUsed: 1, guessesLeft: 2 });
  const first = applyRealtimeClue(st, mine);
  assert.equal(first.state.guessesUsed, 2);
  assert.ok(first.own.seqs.includes(13));
  // 100 later clues by others push seq 13 off the board.
  const others = Array.from({ length: 100 }, (_, i) => ({
    ...entry(14 + i),
    username: 'bob',
  }));
  const cut = { ...first.state, board: others };
  assert.ok(!cut.board.some((e) => e.seq === 13));
  const replay = applyRealtimeClue(cut, mine, first.own);
  assert.equal(replay.state.guessesUsed, 2, 'replayed own clue uses no try');
  // Own entries of a snapshot are remembered; a new day starts empty; size is bounded.
  assert.deepEqual(rememberOwnSeqs(null, snap()).seqs, [11]);
  assert.deepEqual(
    rememberOwnSeqs({ day: DAY, seqs: [5] }, snap({ day: NEXT_DAY, board: [] }))
      .seqs,
    []
  );
  const many = rememberOwnSeqs(
    null,
    snap({ board: [] }),
    Array.from({ length: 40 }, (_, i) => i + 1)
  );
  assert.equal(many.seqs.length, OWN_SEQS_LIMIT);
  assert.equal(many.seqs[0], 40 - OWN_SEQS_LIMIT + 1);
});

test('streak only grows within a day and resets with the day', () => {
  const before = snap({ streak: 4 });
  const late = snap({ streak: 3, totalGuesses: 11 });
  assert.equal(mergeState(before, late).state.streak, 4);
  assert.equal(
    mergeState(before, snap({ streak: 5, totalGuesses: 13 })).state.streak,
    5
  );
  const tomorrow = snap({
    day: NEXT_DAY,
    round: 1,
    spec: specFor(NEXT_DAY, 1),
    streak: 0,
  });
  assert.equal(mergeState(before, tomorrow).state.streak, 0);
});
