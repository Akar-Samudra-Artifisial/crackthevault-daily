import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERNAME_RE, parseLeaderboardResponse } from '../src/shared/api.ts';
import {
  FLAIR_REMOVAL_BATCH,
  FLAIR_REMOVAL_MAX_ATTEMPTS,
  LEADERBOARD_CRACKERS,
  LEADERBOARD_TOP,
  REWARD_MAX_ATTEMPTS,
  SAFECRACKER_FLAIR_TEXT,
  USERNAME_PATTERN,
  buildLeaderboard,
  crackComment,
  crackedAfter,
  deepestOf,
  encodeFlairHolder,
  encodeSavedFlair,
  escapeMarkdown,
  flairToSave,
  isSafecrackerFlair,
  mustRevokeAfterSet,
  parseFlairHolder,
  parseRewardRetryField,
  parseSavedFlair,
  pickPendingRemovals,
  planFlairClaim,
  planFlairRemoval,
  rankFromAscending,
  rewardRetryField,
} from '../src/shared/safecracker.ts';
import { subKeys, vaultKeys } from '../src/server/core/keys.ts';
import type { CrackRecord } from '../src/shared/vault.ts';

const DAY = '20261117';

const roundTrip = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value));

const crack = (round: number, username = 'alice'): CrackRecord => ({
  round,
  username,
  code: [3, 1, 2],
  guesses: 7,
  atMs: 1000 + round,
});

test('crack comment: user, vault, name, guesses, the cracked code only', () => {
  const text = crackComment(crack(2, 'safe_cracker'), 'Brass Strongbox');
  assert.match(
    text,
    /^u\/safe\\_cracker cracked vault #2 \(Brass Strongbox\) in 7 guesses 🔓/
  );
  assert.ok(text.includes('`312`'));
  assert.ok(text.includes('Vault #3 is open now.'));
  assert.match(
    crackComment({ ...crack(1), guesses: 1 }, 'X'),
    / in 1 guess 🔓/
  );
});

test('flair text check trims and ignores other flairs', () => {
  assert.ok(isSafecrackerFlair(SAFECRACKER_FLAIR_TEXT));
  assert.ok(isSafecrackerFlair(`  ${SAFECRACKER_FLAIR_TEXT} `));
  for (const other of [null, undefined, '', 'Mod', 'Safecracker'])
    assert.ok(!isSafecrackerFlair(other), String(other));
});

test('flair holder round-trips; plan moves it forward only', () => {
  const h = { day: DAY, round: 2, username: 'bob' };
  assert.deepEqual(parseFlairHolder(encodeFlairHolder(h)), h);
  for (const bad of [
    null,
    undefined,
    '',
    'bob',
    '2026111:2:bob',
    `${DAY}:2:b ob`,
  ])
    assert.equal(parseFlairHolder(bad), null, String(bad));

  assert.deepEqual(
    planFlairClaim(null, { day: DAY, round: 1, username: 'a' }),
    { kind: 'claim', removeFrom: null }
  );
  assert.deepEqual(
    planFlairClaim(h, { day: DAY, round: 3, username: 'alice' }),
    { kind: 'claim', removeFrom: 'bob' }
  );
  // Same holder cracks again: claim, nothing to remove.
  assert.deepEqual(
    planFlairClaim(h, { day: '20261118', round: 1, username: 'bob' }),
    { kind: 'claim', removeFrom: null }
  );
  // The holder's own crack again (earlier attempt failed to set the flair): retry.
  assert.deepEqual(planFlairClaim(h, h), { kind: 'retry' });
  // A late reward for an older crack never takes the flair back.
  for (const older of [
    { day: DAY, round: 1, username: 'alice' },
    { day: DAY, round: 2, username: 'alice' },
    { day: '20261116', round: 9, username: 'alice' },
  ])
    assert.deepEqual(planFlairClaim(h, older), { kind: 'skip' });
});

test('holder accepts every valid Reddit username, same pattern as the API parser', () => {
  for (const name of ['abc', 'A-b_9', 'x'.repeat(20), 'ab-_-_-_-_-_-_-_-_-z'])
    assert.deepEqual(
      parseFlairHolder(`${DAY}:4:${name}`),
      { day: DAY, round: 4, username: name },
      name
    );
  assert.equal(USERNAME_RE.source, `^${USERNAME_PATTERN}$`);
});

test('flair set by a stale reward is revoked when a newer crack holds it', () => {
  const ref = { day: DAY, round: 2, username: 'alice' };
  assert.ok(mustRevokeAfterSet({ day: DAY, round: 3, username: 'bob' }, ref));
  assert.ok(!mustRevokeAfterSet(ref, ref));
  assert.ok(!mustRevokeAfterSet(null, ref));
  assert.ok(
    !mustRevokeAfterSet({ day: DAY, round: 3, username: 'alice' }, ref)
  );
  assert.ok(!mustRevokeAfterSet({ day: DAY, round: 1, username: 'bob' }, ref));
  assert.ok(
    crackedAfter({ day: '20261118', round: 1 }, { day: DAY, round: 9 })
  );
});

test('own flair is saved before ours and restored, removed or kept after', () => {
  const saved = flairToSave({ flairText: 'Mod pick', flairCssClass: 'gold' });
  assert.deepEqual(saved, { text: 'Mod pick', cssClass: 'gold' });
  assert.equal(flairToSave(undefined), null);
  assert.equal(flairToSave({ flairText: '  ' }), null);
  assert.equal(flairToSave({ flairText: SAFECRACKER_FLAIR_TEXT }), null);
  assert.deepEqual(flairToSave({ flairText: 'x', flairCssClass: 'a<b' }), {
    text: 'x',
    cssClass: '',
  });
  assert.ok(saved);
  assert.deepEqual(parseSavedFlair(encodeSavedFlair(saved)), saved);
  for (const bad of [null, '', '{', '[]', '{"text":1,"cssClass":""}'])
    assert.equal(parseSavedFlair(bad), null, String(bad));
  assert.deepEqual(planFlairRemoval(SAFECRACKER_FLAIR_TEXT, saved), {
    kind: 'restore',
    flair: saved,
  });
  assert.deepEqual(planFlairRemoval(SAFECRACKER_FLAIR_TEXT, null), {
    kind: 'remove',
  });
  assert.deepEqual(planFlairRemoval('Changed by mod', saved), { kind: 'keep' });
});

test('pending flair removals: holder, corrupt and exhausted dropped, batch bounded', () => {
  const { retry, drop } = pickPendingRemovals(
    {
      bob: '1',
      carol: '0',
      dave: String(FLAIR_REMOVAL_MAX_ATTEMPTS),
      'bad name': '1',
      erin: 'x',
      frank: '2',
      gina: '1',
      holder: '1',
    },
    'holder',
    3
  );
  assert.deepEqual(retry, ['bob', 'carol', 'frank']);
  assert.deepEqual(drop.sort(), ['bad name', 'dave', 'erin', 'holder']);
  assert.ok(FLAIR_REMOVAL_BATCH >= 1);
});

test('reward retry fields round-trip; garbage rejected', () => {
  assert.equal(rewardRetryField('flair', 3), 'flair:3');
  assert.deepEqual(parseRewardRetryField('comment:12'), {
    kind: 'comment',
    round: 12,
  });
  for (const bad of ['flair:0', 'post:1', 'flair:', 'flair:1:2'])
    assert.equal(parseRewardRetryField(bad), null, bad);
  assert.ok(REWARD_MAX_ATTEMPTS >= 1);
});

test('escapeMarkdown neutralises html, entities and mentions', () => {
  assert.equal(
    escapeMarkdown('a&b <i>x</i> @u_1'),
    'a&amp;b &lt;i&gt;x&lt;/i&gt; \\@u\\_1'
  );
});

test('reward markers are one key per (sub, day, round)', () => {
  const k = vaultKeys('t5_abc', DAY);
  assert.equal(k.flairDone(2), 'v:t5_abc:20261117:reward:flair:2');
  assert.equal(k.commentDone(2), 'v:t5_abc:20261117:reward:comment:2');
  assert.notEqual(k.flairDone(2), k.flairDone(3));
  assert.notEqual(k.flairDone(2), vaultKeys('t5_abc', '20261118').flairDone(2));
  assert.notEqual(k.commentDone(2), vaultKeys('t5_x', DAY).commentDone(2));
  const s = subKeys('t5_abc');
  assert.equal(s.crackCount, 'v:t5_abc:crackcount');
  assert.equal(s.flairHolder, 'v:t5_abc:safecracker');
});

test('deepestOf: highest round, earliest on a tie', () => {
  const r = (day: string, round: number, atMs: number) => ({
    day,
    round,
    username: 'u',
    atMs,
  });
  assert.equal(deepestOf([]), null);
  assert.deepEqual(
    deepestOf([
      r('20261110', 4, 50),
      r('20261111', 6, 90),
      r('20261112', 6, 10),
    ]),
    r('20261112', 6, 10)
  );
});

test('rank from ascending zRank', () => {
  assert.equal(rankFromAscending(9, 10), 1);
  assert.equal(rankFromAscending(0, 10), 10);
  assert.equal(rankFromAscending(undefined, 10), null);
  assert.equal(rankFromAscending(10, 10), null);
});

test('leaderboard: capped lists, corrupt rows skipped, parser round-trip', () => {
  const today = { day: DAY, round: 30, username: 'alice', atMs: 5 };
  const top = [
    { member: 'bad name', score: 9 },
    ...Array.from({ length: 15 }, (_, i) => ({
      member: `user${i}`,
      score: 20 - i,
    })),
  ];
  const lb = buildLeaderboard({
    day: DAY,
    today,
    allDays: [{ day: '20261101', round: 12, username: 'bob', atMs: 1 }],
    cracks: Array.from({ length: 29 }, (_, i) => crack(i + 1)),
    cracksTotal: 29,
    top,
    me: { username: 'alice', cracks: 3, rank: 12, streak: 4 },
  });
  assert.equal(lb.top.length, LEADERBOARD_TOP);
  assert.deepEqual(lb.top[0], { rank: 1, username: 'user0', cracks: 20 });
  assert.equal(lb.crackers.length, LEADERBOARD_CRACKERS);
  assert.equal(lb.crackers[0]?.round, 10); // newest 20, oldest first
  assert.equal(lb.crackersTotal, 29);
  assert.deepEqual(lb.record, today);
  assert.deepEqual(parseLeaderboardResponse(roundTrip(lb)), lb);

  const empty = buildLeaderboard({
    day: DAY,
    today: null,
    allDays: [],
    cracks: [],
    cracksTotal: 0,
    top: [],
    me: null,
  });
  assert.deepEqual(parseLeaderboardResponse(roundTrip(empty)), empty);

  const bad: unknown[] = [
    null,
    { ...lb, status: 'error' },
    { ...lb, day: '2026-11-17' },
    { ...lb, today: { ...today, day: '20261116' } },
    { ...lb, record: null },
    { ...lb, crackersTotal: 3 },
    { ...lb, top: [...lb.top, { rank: 11, username: 'x', cracks: 1 }] },
    { ...lb, crackers: [...lb.crackers, crack(30)] },
    { ...lb, me: { ...lb.me, rank: 0 } },
    { ...lb, me: { username: 'alice', cracks: 1, rank: null } },
  ];
  for (const raw of bad)
    assert.equal(parseLeaderboardResponse(raw), null, JSON.stringify(raw));
});
