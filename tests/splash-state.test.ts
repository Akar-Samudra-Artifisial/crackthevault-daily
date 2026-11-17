import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TIER_KEYS,
  parseSplashState,
  tierText,
} from '../src/shared/splash-state.ts';
import { LEVEL_LADDER } from '../src/shared/vault.ts';

const body = () => ({
  status: 'ok',
  day: '20261117',
  spec: { name: 'Brass Strongbox', dials: 5, maxDigit: 7, unique: false },
  round: 6,
  codesLeft: 4,
  codesLeftStale: false,
  boardTotal: 8,
  cracks: [
    { round: 4, username: 'mintcondition', code: [1], guesses: 3, atMs: 1 },
    { round: 5, username: 'brassmonkey', code: [1], guesses: 3, atMs: 2 },
  ],
  username: 'safe_hands',
  guessesUsed: 2,
  guessesLeft: 1,
  streak: 2,
});

test('splash tier ladder matches LEVEL_LADDER', () => {
  assert.deepEqual(
    TIER_KEYS,
    LEVEL_LADDER.map((l) => `${l.dials}:${l.maxDigit}:${l.unique ? 1 : 0}`)
  );
  assert.equal(
    tierText({ dials: 6, maxDigit: 9, unique: false }),
    'Tier 9 of 9'
  );
  assert.equal(
    tierText({ dials: 3, maxDigit: 4, unique: false }),
    'Tier 1 of 9'
  );
  assert.equal(tierText({ dials: 7, maxDigit: 9, unique: false }), 'Tier ?');
});

test('parseSplashState keeps only the splash fields', () => {
  const st = parseSplashState(body());
  assert.ok(st);
  assert.deepEqual(st.lastCrack, { round: 5, username: 'brassmonkey' });
  assert.equal(st.spec.name, 'Brass Strongbox');
  assert.equal(st.streak, 2);
  assert.equal(parseSplashState({ ...body(), cracks: [] })?.lastCrack, null);
  assert.equal(
    parseSplashState({ ...body(), codesLeft: null })?.codesLeft,
    null
  );
  assert.equal(parseSplashState({ ...body(), username: null })?.username, null);
});

test('parseSplashState rejects malformed bodies', () => {
  for (const bad of [
    null,
    'ok',
    { ...body(), status: 'error' },
    { ...body(), spec: { ...body().spec, dials: 'five' } },
    { ...body(), round: 0 },
    { ...body(), codesLeft: -1 },
    { ...body(), codesLeftStale: 'no' },
    { ...body(), cracks: [{ round: 1, username: '<b>x</b>' }] },
    { ...body(), cracks: 'none' },
    { ...body(), username: 42 },
    { ...body(), streak: 1.5 },
  ])
    assert.equal(parseSplashState(bad), null);
});
