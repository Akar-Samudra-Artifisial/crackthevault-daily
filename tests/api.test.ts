import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBoardEntry,
  parseGuessRequest,
  parseGuessResponse,
  parseStateResponse,
  parseStoredBoardEntry,
  parseStoredDeepest,
  type StateResponse,
} from '../src/shared/api.ts';
import { specFor } from '../src/shared/vault.ts';

const DAY = '20261117';

const state: StateResponse = {
  status: 'ok',
  day: DAY,
  spec: specFor(DAY, 2),
  round: 2,
  totalGuesses: 7,
  board: [
    {
      id: 'abc-12345678',
      seq: 6,
      round: 2,
      username: 'alice',
      guess: [0, 1, 2],
      exact: 1,
      misplaced: 0,
    },
  ],
  boardTotal: 1,
  codesLeft: 42,
  codesLeftStale: false,
  channel: 'vault_t5_abc_20261117',
  drill: {
    revealed: [{ dial: 1, digit: 5 }],
    nextDrillAt: 1_763_366_400_000,
    intervalMs: 21_600_000,
  },
  cracks: [{ round: 1, username: 'bob', code: [5, 5, 1], guesses: 5, atMs: 1 }],
  cracksTotal: 1,
  deepest: { day: DAY, round: 1, username: 'bob', atMs: 1 },
  username: 'alice',
  guessesUsed: 2,
  guessLimit: 3,
  guessesLeft: 1,
  streak: 3,
  serverTime: '2026-11-17T10:00:00.000Z',
};

const roundTrip = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value));

test('parseGuessRequest requires a yyyymmdd day and a round ≥ 1', () => {
  assert.deepEqual(parseGuessRequest({ guess: '012', day: DAY, round: 1 }), {
    guess: '012',
    day: DAY,
    round: 1,
  });
  for (const bad of [
    { guess: '012', round: 1 },
    { guess: '012', day: '2026-11-17', round: 1 },
    { guess: '012', day: 20261117, round: 1 },
    { guess: '012', day: DAY, round: 0 },
    { guess: '012', day: DAY, round: '1' },
    null,
    'x',
  ])
    assert.equal(parseGuessRequest(bad), null, JSON.stringify(bad));
});

test('parseStateResponse round-trips and checks day/spec consistency', () => {
  assert.deepEqual(parseStateResponse(roundTrip(state)), state);
  assert.equal(parseStateResponse({ ...state, day: '20261118' }), null);
  assert.equal(parseStateResponse({ ...state, day: undefined }), null);
  assert.equal(parseStateResponse({ ...state, boardTotal: -1 }), null);
  assert.equal(parseStateResponse({ ...state, cracksTotal: undefined }), null);
  assert.equal(parseStateResponse({ ...state, board: [{ seq: 1 }] }), null);
  assert.equal(parseStateResponse({ ...state, username: 5 }), null);
  // spec must be the active round's; codesLeft and deepest are required/validated.
  assert.equal(parseStateResponse({ ...state, spec: specFor(DAY, 1) }), null);
  assert.equal(parseStateResponse({ ...state, codesLeft: undefined }), null);
  assert.equal(parseStateResponse({ ...state, codesLeft: -3 }), null);
  // codesLeft may be null (being computed) or stale (an older upper bound).
  assert.equal(
    parseStateResponse(roundTrip({ ...state, codesLeft: null }))?.codesLeft,
    null
  );
  assert.equal(
    parseStateResponse(roundTrip({ ...state, codesLeftStale: true }))
      ?.codesLeftStale,
    true
  );
  assert.equal(
    parseStateResponse({ ...state, codesLeftStale: undefined }),
    null
  );
  assert.equal(parseStateResponse({ ...state, channel: 'vault-t5:x' }), null);
  assert.equal(parseStateResponse({ ...state, channel: undefined }), null);
  assert.equal(parseStateResponse({ ...state, streak: -1 }), null);
  assert.equal(parseStateResponse({ ...state, streak: undefined }), null);
  assert.equal(parseStateResponse({ ...state, deepest: undefined }), null);
  assert.equal(
    parseStateResponse({
      ...state,
      deepest: { ...state.deepest, day: '20261116' },
    }),
    null
  );
  assert.equal(
    parseStateResponse({ ...state, deepest: { ...state.deepest, round: 0 } }),
    null
  );
  assert.equal(
    parseStateResponse(roundTrip({ ...state, deepest: null }))?.deepest,
    null
  );
  assert.deepEqual(
    parseStateResponse(roundTrip({ ...state, username: null }))?.username,
    null
  );
});

test('state drill: at most dials − 1 opened dials that fit the spec', () => {
  const withDrill = (drill: unknown) => parseStateResponse({ ...state, drill });
  const ok = state.drill;
  assert.deepEqual(
    parseStateResponse(
      roundTrip({ ...state, drill: { ...ok, nextDrillAt: null } })
    )?.drill.nextDrillAt,
    null
  );
  // spec of `state`: 3 dials, 0–5
  const bad = [
    undefined,
    { ...ok, revealed: undefined },
    { ...ok, intervalMs: 0 },
    { ...ok, nextDrillAt: 'soon' },
    { ...ok, revealed: [{ dial: 3, digit: 1 }] }, // dial outside the code
    { ...ok, revealed: [{ dial: 0, digit: 6 }] }, // digit > maxDigit
    {
      ...ok,
      revealed: [
        { dial: 0, digit: 1 },
        { dial: 0, digit: 1 },
      ],
    }, // duplicate dial
    {
      ...ok,
      revealed: [
        { dial: 0, digit: 1 },
        { dial: 1, digit: 1 },
        { dial: 2, digit: 1 },
      ],
    }, // the whole code
  ];
  for (const drill of bad)
    assert.equal(withDrill(drill), null, JSON.stringify(drill));
});

test('parseGuessResponse accepts ok/rejected and refuses unknown codes', () => {
  const ok = {
    status: 'ok',
    result: {
      guess: [0, 1, 2],
      exact: 1,
      misplaced: 0,
      cracked: false,
      round: 2,
    },
    state,
  };
  assert.equal(parseGuessResponse(roundTrip(ok))?.status, 'ok');
  const stale = { status: 'rejected', code: 'stale', message: 'closed', state };
  assert.equal(parseGuessResponse(roundTrip(stale))?.status, 'rejected');
  assert.equal(parseGuessResponse({ ...stale, code: 'nope' }), null);
});

test('board entries need a request id; corrupt stored JSON is null', () => {
  const entry = state.board[0];
  assert.deepEqual(parseStoredBoardEntry(JSON.stringify(entry)), entry);
  assert.equal(parseBoardEntry({ ...entry, id: undefined }), null);
  assert.equal(parseBoardEntry({ ...entry, id: 'x' }), null);
  assert.equal(parseStoredBoardEntry('{nope'), null);
});

test('stored deepest record round-trips; corrupt JSON is null', () => {
  const rec = { day: DAY, round: 4, username: 'carol', atMs: 99 };
  assert.deepEqual(parseStoredDeepest(JSON.stringify(rec)), rec);
  assert.equal(
    parseStoredDeepest(JSON.stringify({ ...rec, username: 'no spaces!' })),
    null
  );
  assert.equal(parseStoredDeepest('{'), null);
});
