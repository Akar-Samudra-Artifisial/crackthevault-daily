import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextStreak,
  parseStreak,
  previousDay,
  visibleStreak,
} from '../src/shared/streak.ts';

test('previousDay crosses month, year and leap-day boundaries', () => {
  assert.equal(previousDay('20261117'), '20261116');
  assert.equal(previousDay('20260301'), '20260228');
  assert.equal(previousDay('20280301'), '20280229');
  assert.equal(previousDay('20270101'), '20261231');
});

test('nextStreak: first, same day, next day, gap', () => {
  assert.deepEqual(nextStreak(null, '20261117'), { day: '20261117', count: 1 });
  const s = { day: '20261117', count: 4 };
  assert.deepEqual(nextStreak(s, '20261117'), s);
  assert.deepEqual(nextStreak(s, '20261118'), { day: '20261118', count: 5 });
  assert.deepEqual(nextStreak(s, '20261120'), { day: '20261120', count: 1 });
});

test('visibleStreak is alive today and yesterday only', () => {
  const s = { day: '20261117', count: 3 };
  assert.equal(visibleStreak(s, '20261117'), 3);
  assert.equal(visibleStreak(s, '20261118'), 3);
  assert.equal(visibleStreak(s, '20261119'), 0);
  assert.equal(visibleStreak(null, '20261117'), 0);
});

test('parseStreak refuses corrupt values', () => {
  assert.deepEqual(parseStreak('{"day":"20261117","count":2}'), {
    day: '20261117',
    count: 2,
  });
  for (const bad of [
    null,
    undefined,
    '',
    'x',
    'null',
    '{"day":"2026-11-17","count":2}',
    '{"day":"20261117","count":0}',
    '{"day":"20261117","count":1.5}',
  ])
    assert.equal(parseStreak(bad), null, String(bad));
});
