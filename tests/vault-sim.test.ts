import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_LADDER, codeSpaceSize, specFor } from '../src/shared/vault.ts';
import {
  REALISTIC,
  SHARP_CROWD,
  meanGuessesToCrack,
  mulberry32,
  simulateDay,
  spaceFor,
} from '../tools/sim/engine.ts';
import { TIER_DAYS, levelForDay } from '../tools/sim/vault-sim.ts';

test('sim code spaces match the shared ladder sizes', () => {
  for (const level of LEVEL_LADDER.slice(0, 6))
    assert.equal(spaceFor(level).n, codeSpaceSize(level));
  assert.equal(spaceFor({ dials: 3, maxDigit: 5, unique: true }).n, 120);
});

test('a simulated day uses exactly 3 guesses per player and climbs the ladder', () => {
  const r = simulateDay({
    levelFor: levelForDay(TIER_DAYS['easy (Mon–Tue)']),
    players: 60,
    model: SHARP_CROWD,
    rng: mulberry32(2),
  });
  assert.equal(r.totalGuesses, 180);
  assert.equal(r.cracks, r.guessesPerCrack.length);
  assert.equal(r.deepest, r.cracks);
  assert.ok(r.guessesPerCrack.reduce((a, b) => a + b, 0) <= r.totalGuesses);
  assert.ok(r.cracks >= 3, `sharp crowd cracked ${r.cracks}`);
});

test('timed days record drilled dials at each crack, never more than dials − 1', () => {
  const rng = mulberry32(9);
  let cracks = 0;
  for (let i = 0; i < 40; i++) {
    const r = simulateDay({
      levelFor: levelForDay(TIER_DAYS['expert (Sat–Sun)']),
      players: 10,
      model: REALISTIC,
      rng,
    });
    assert.equal(r.openAtCrack.length, r.cracks);
    r.openAtCrack.forEach((open, i) => {
      const dials = specFor(TIER_DAYS['expert (Sat–Sun)'], i + 1).dials;
      assert.ok(open >= 0 && open <= dials - 1, `open ${open}`);
    });
    cracks += r.cracks;
  }
  assert.ok(cracks >= 40, `10 players cracked ${cracks} vaults in 40 days`);
});

test('vault #2 costs the realistic crowd more guesses from easy to expert', () => {
  const rng = mulberry32(4);
  const means = Object.values(TIER_DAYS).map((day) =>
    meanGuessesToCrack(specFor(day, 2), 150, REALISTIC, rng)
  );
  const [easy = 0, , , expert = 0] = means;
  assert.ok(expert > easy * 2, `easy ${easy}, expert ${expert}`);
});
