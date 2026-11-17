import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRealtimeEvent, type StateResponse } from '../src/shared/api.ts';
import {
  drillEvent,
  guessEvent,
  vaultChannel,
} from '../src/shared/realtime.ts';
import { specFor, type BoardEntry } from '../src/shared/vault.ts';

const DAY = '20261117';

const roundTrip = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value));

/** Public state after a commit: vault #3 open, one dial of it drilled. */
const state: StateResponse = {
  status: 'ok',
  day: DAY,
  spec: specFor(DAY, 3), // 4 dials, 0–5
  round: 3,
  totalGuesses: 12,
  board: [],
  boardTotal: 0,
  codesLeft: 216,
  codesLeftStale: false,
  drill: {
    revealed: [{ dial: 2, digit: 4 }],
    nextDrillAt: 1_763_366_400_000,
    intervalMs: 21_600_000,
  },
  channel: vaultChannel('t5_abc', DAY),
  cracks: [],
  cracksTotal: 2,
  deepest: { day: DAY, round: 2, username: 'bob', atMs: 5 },
  username: 'alice',
  guessesUsed: 3,
  guessLimit: 3,
  guessesLeft: 0,
  streak: 4,
  serverTime: '2026-11-17T10:00:00.000Z',
};

const entry = (round: number, guess: number[], exact: number): BoardEntry => ({
  id: 'req-00000001',
  seq: 12,
  round,
  username: 'alice',
  guess,
  exact,
  misplaced: 0,
});

test('channel names keep only letters, digits and _ (Devvit realtime rule)', () => {
  assert.equal(vaultChannel('t5_abc', DAY), 'vault_t5_abc_20261117');
  assert.equal(vaultChannel('t5-a.b:c', DAY), 'vault_t5_a_b_c_20261117');
  assert.match(vaultChannel('t5 ü/x', DAY), /^[A-Za-z0-9_]+$/);
});

test('clue event round-trips through the parser and carries only public fields', () => {
  const event = guessEvent({
    state: { ...state, round: 2, spec: specFor(DAY, 2) },
    entry: entry(2, [0, 1, 2], 1),
    crack: null,
    nextSpec: null,
    cracker: { streak: 4, cracks: 2 },
  });
  assert.equal(event.type, 'clue');
  assert.deepEqual(parseRealtimeEvent(roundTrip(event)), event);
  // Per-user fields and the request id never go on the channel.
  const json = JSON.stringify(event);
  for (const key of ['guessesLeft', 'guessesUsed', 'serverTime', 'req-'])
    assert.ok(!json.includes(key), key);
});

test('cracked event: closed round code + next spec, active drill only opened dials', () => {
  const crack = {
    round: 2,
    username: 'alice',
    code: [3, 1, 2],
    guesses: 6,
    atMs: 99,
  };
  const event = guessEvent({
    state,
    entry: entry(2, [3, 1, 2], 3),
    crack,
    nextSpec: specFor(DAY, 3),
    cracker: { streak: 4, cracks: 2 },
  });
  assert.equal(event.type, 'cracked');
  const parsed = parseRealtimeEvent(roundTrip(event));
  assert.deepEqual(parsed, event);
  if (parsed?.type !== 'cracked') return;
  assert.deepEqual(parsed.crack.code, [3, 1, 2]);
  assert.equal(parsed.crackerStreak, 4);
  assert.equal(parsed.crackerCracks, 2);
  assert.equal(parseRealtimeEvent({ ...event, crackerStreak: 0 }), null);
  assert.equal(parsed.nextSpec.round, 3);
  assert.deepEqual(parsed.deepest, {
    day: DAY,
    round: 2,
    username: 'alice',
    atMs: 99,
  });
  // The open vault (#3) shows exactly the drilled dial of the state, nothing else.
  assert.deepEqual(parsed.active.drill.revealed, [{ dial: 2, digit: 4 }]);
});

test('drill event round-trips; malformed events are refused', () => {
  const drill = drillEvent(state);
  assert.deepEqual(parseRealtimeEvent(roundTrip(drill)), drill);
  const cracked = guessEvent({
    state,
    entry: entry(2, [3, 1, 2], 3),
    crack: {
      round: 2,
      username: 'alice',
      code: [3, 1, 2],
      guesses: 6,
      atMs: 9,
    },
    nextSpec: specFor(DAY, 3),
    cracker: { streak: 4, cracks: 2 },
  });
  const bad: unknown[] = [
    null,
    { ...drill, type: 'secret' },
    { ...drill, day: '2026-11-17' },
    { ...drill, round: 4 }, // active round differs
    { ...drill, active: { ...drill.active, codesLeft: -1 } },
    // the whole code of a 4-dial vault "drilled"
    {
      ...drill,
      active: {
        ...drill.active,
        drill: {
          ...state.drill,
          revealed: [0, 1, 2, 3].map((dial) => ({ dial, digit: 1 })),
        },
      },
    },
    // cracked: code must be the cracking guess of the same round, next spec = round + 1
    {
      ...cracked,
      crack: {
        round: 2,
        username: 'alice',
        code: [0, 0, 0],
        guesses: 6,
        atMs: 9,
      },
    },
    { ...cracked, nextSpec: specFor(DAY, 2) },
    // drill digit outside vault #3's 0–5 range
    {
      ...cracked,
      active: {
        ...drill.active,
        drill: { ...state.drill, revealed: [{ dial: 0, digit: 9 }] },
      },
    },
  ];
  for (const raw of bad)
    assert.equal(parseRealtimeEvent(raw), null, JSON.stringify(raw));
});
