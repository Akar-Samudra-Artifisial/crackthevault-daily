import assert from 'node:assert/strict';
import test from 'node:test';
import { postTitle } from '../src/shared/post-title.ts';

test('postTitle: UTC weekday, day without leading zero, English month', () => {
  const cases: [string, string][] = [
    ['20261117', 'Tue 17 Nov'],
    ['20261101', 'Sun 1 Nov'],
    ['20261130', 'Mon 30 Nov'],
    ['20261201', 'Tue 1 Dec'],
    ['20261231', 'Thu 31 Dec'],
    ['20270101', 'Fri 1 Jan'],
    ['20280228', 'Mon 28 Feb'],
    ['20280229', 'Tue 29 Feb'],
    ['20280301', 'Wed 1 Mar'],
  ];
  for (const [day, date] of cases)
    assert.equal(
      postTitle(day),
      `Crack the Vault — Daily Vault · ${date}`,
      day
    );
});

test('postTitle rejects keys that are not real days', () => {
  for (const bad of [
    '',
    '2026111',
    '20261131',
    '20270229',
    '20261300',
    'abcdefgh',
  ])
    assert.throws(() => postTitle(bad), /invalid day key/, bad);
});
