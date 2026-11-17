import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRILL_INTERVAL_MS,
  dayStartMs,
  decodeDrillOrder,
  drillCount,
  drillView,
  encodeDrillOrder,
  generateDrillOrder,
  nextDrillAt,
  revealDials,
} from '../src/shared/drill.ts';
import { remainingCodes, specFor } from '../src/shared/vault.ts';

const H = 60 * 60 * 1000;
const START = dayStartMs('20261117');

test('dayStartMs is 00:00 UTC of the day', () => {
  assert.equal(new Date(START).toISOString(), '2026-11-17T00:00:00.000Z');
  assert.equal(DRILL_INTERVAL_MS, 6 * H);
});

test('one dial opens per 6 hours: 0 / 6 / 12 / 18 hours → 0 / 1 / 2 / 3 dials', () => {
  const at = (hours: number) => drillCount(6, START, START + hours * H);
  assert.equal(at(0), 0);
  assert.equal(at(5.99), 0);
  assert.equal(at(6), 1);
  assert.equal(at(11.99), 1);
  assert.equal(at(12), 2);
  assert.equal(at(18), 3);
  assert.equal(at(23.99), 3);
  // A clock behind the start (skew) never opens anything.
  assert.equal(drillCount(6, START, START - H), 0);
  // Vault #N+1 counts from its own start (the crack), not from midnight.
  const crackAt = START + 13 * H;
  assert.equal(drillCount(6, crackAt, START + 18 * H), 0);
  assert.equal(drillCount(6, crackAt, START + 19 * H), 1);
});

test('the drill never opens more than dials − 1 dials', () => {
  for (const dials of [3, 4, 5, 6]) {
    assert.equal(drillCount(dials, START, START + 1000 * H), dials - 1);
    assert.equal(nextDrillAt(dials, START, START + 1000 * H), null);
  }
  // 3 dials: two openings at 6 h and 12 h, then no next drill.
  assert.equal(nextDrillAt(3, START, START), START + 6 * H);
  assert.equal(nextDrillAt(3, START, START + 6 * H), START + 12 * H);
  assert.equal(nextDrillAt(3, START, START + 12 * H), null);
  assert.equal(revealDials([1, 2, 3], [0, 1, 2], 99).length, 2);
});

test('drill order is a permutation, round-trips, and corrupt orders are refused', () => {
  let seed = 7;
  const rnd = (max: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };
  for (let i = 0; i < 50; i++) {
    const order = generateDrillOrder(6, rnd);
    assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(decodeDrillOrder(encodeDrillOrder(order), 6), order);
  }
  for (const bad of [null, '', '012', '01234', '0012', '01a', '0124'])
    assert.equal(decodeDrillOrder(bad, 4), null, String(bad));
  assert.throws(() => generateDrillOrder(4, () => 9));
});

test('no leak: only opened dials of the secret appear in the drill view', () => {
  const secret = [6, 7, 8, 9]; // distinct digits: any leak would be visible
  const order = [2, 0, 3, 1];
  const opened = (hours: number) =>
    drillView({ secret, order, startMs: START, nowMs: START + hours * H })
      .revealed;
  assert.deepEqual(opened(0), []);
  assert.deepEqual(opened(6), [{ dial: 2, digit: 8 }]);
  assert.deepEqual(opened(12), [
    { dial: 2, digit: 8 },
    { dial: 0, digit: 6 },
  ]);
  const late = opened(1000);
  assert.deepEqual(late, [
    { dial: 2, digit: 8 },
    { dial: 0, digit: 6 },
    { dial: 3, digit: 9 },
  ]);
  // Dial 1 (digit 7) is never opened: the full code never becomes public.
  assert.ok(late.every((r) => r.dial !== 1 && r.digit !== 7));
});

test('remainingCodes keeps only codes that show the opened digits', () => {
  const spec = specFor('20261117', 1); // 3 dials, 0–4: 125 codes
  assert.equal(remainingCodes(spec, []), 125);
  assert.equal(remainingCodes(spec, [], [{ dial: 0, digit: 2 }]), 25);
  assert.equal(
    remainingCodes(
      spec,
      [],
      [
        { dial: 0, digit: 2 },
        { dial: 2, digit: 4 },
      ]
    ),
    5
  );
  // Opened dials combined with a clue: checked against a brute-force count of 2 ? 4.
  const clue = { guess: [2, 1, 0], exact: 1, misplaced: 0 };
  const brute = (): number => {
    let n = 0;
    for (let m = 0; m <= 4; m++) {
      const code = [2, m, 4];
      const exact = code.filter((d, i) => d === clue.guess[i]).length;
      const common = [0, 1, 2, 3, 4].reduce(
        (a, d) =>
          a +
          Math.min(
            code.filter((x) => x === d).length,
            clue.guess.filter((x) => x === d).length
          ),
        0
      );
      if (exact === 1 && common - exact === 0) n++;
    }
    return n;
  };
  assert.equal(
    remainingCodes(
      spec,
      [clue],
      [
        { dial: 0, digit: 2 },
        { dial: 2, digit: 4 },
      ]
    ),
    brute()
  );
});
