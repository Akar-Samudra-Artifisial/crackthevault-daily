import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codesLeftLockSuffix,
  encodeCodesLeft,
  fallbackCodesLeft,
  parseCodesLeft,
  planCodesLeft,
} from '../src/shared/codes-left.ts';

const want = { round: 2, clues: 7, drilled: 1 };

test('cache value round-trips; corrupt values are ignored', () => {
  const c = { ...want, value: 345 };
  assert.deepEqual(parseCodesLeft(encodeCodesLeft(c)), c);
  for (const bad of [null, undefined, '', '2:7:345', 'a:b:c:d', '2:7:1:-3'])
    assert.equal(parseCodesLeft(bad), null, String(bad));
  assert.equal(codesLeftLockSuffix(want), '2:7:1');
});

test('exact version is a fresh hit; anything else must be computed', () => {
  assert.deepEqual(planCodesLeft({ ...want, value: 9 }, want), {
    kind: 'hit',
    view: { codesLeft: 9, stale: false },
  });
  for (const cached of [
    null,
    { ...want, clues: 6, value: 9 },
    { ...want, drilled: 0, value: 9 },
    { ...want, round: 1, value: 9 },
  ])
    assert.deepEqual(planCodesLeft(cached, want), { kind: 'compute' });
});

test('without the lock: older value of the same round is stale, else null', () => {
  assert.deepEqual(fallbackCodesLeft({ ...want, clues: 5, value: 40 }, want), {
    codesLeft: 40,
    stale: true,
  });
  assert.deepEqual(
    fallbackCodesLeft({ ...want, drilled: 0, value: 80 }, want),
    { codesLeft: 80, stale: true }
  );
  const none = { codesLeft: null, stale: false };
  assert.deepEqual(fallbackCodesLeft(null, want), none);
  // Another round's value or a newer one (fewer codes than this version) is never reused.
  assert.deepEqual(
    fallbackCodesLeft({ ...want, round: 1, value: 3 }, want),
    none
  );
  assert.deepEqual(
    fallbackCodesLeft({ ...want, clues: 9, value: 3 }, want),
    none
  );
});
