import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_META,
  GUESSES_PER_DAY,
  LEVEL_LADDER,
  codeSpaceSize,
  decodeCode,
  encodeCode,
  generateSecret,
  guessDecision,
  guessesLeft,
  isStaleDay,
  metaToHash,
  parseGuess,
  parseMetaHash,
  planGuess,
  remainingCodes,
  scoreGuess,
  specFor,
  type VaultSpec,
  type VaultMeta,
} from '../src/shared/vault.ts';

// 2026-11-16 is a Monday.
const WEEK = {
  mon: '20261116',
  tue: '20261117',
  wed: '20261118',
  thu: '20261119',
  fri: '20261120',
  sat: '20261121',
  sun: '20261122',
};

const shape = (s: VaultSpec) => [s.dials, s.maxDigit, s.unique];

test('vault #1 is the same easy rung (3 dials, 0–4) on every weekday', () => {
  for (const day of Object.values(WEEK)) {
    const s = specFor(day, 1);
    assert.deepEqual([...shape(s), s.round], [3, 4, false, 1], day);
  }
  assert.equal(specFor(WEEK.sat, 1).difficulty, 'expert');
  assert.equal(specFor(WEEK.mon, 1).difficulty, 'easy');
});

test('from vault #2 the weekday escalates: expert > hard > medium > easy', () => {
  const second = (day: string) => {
    const s = specFor(day, 2);
    return [...shape(s), s.difficulty, s.round];
  };
  assert.deepEqual(second(WEEK.mon), [3, 5, false, 'easy', 2]);
  assert.deepEqual(second(WEEK.tue), [3, 5, false, 'easy', 2]);
  assert.deepEqual(second(WEEK.wed), [4, 5, false, 'medium', 2]);
  assert.deepEqual(second(WEEK.thu), [4, 5, false, 'medium', 2]);
  assert.deepEqual(second(WEEK.fri), [4, 7, false, 'hard', 2]);
  assert.deepEqual(second(WEEK.sat), [4, 9, false, 'expert', 2]);
  assert.deepEqual(second(WEEK.sun), [4, 9, false, 'expert', 2]);
  // Every vault #2+ is strictly bigger on harder days until the top rung caps them.
  for (let round = 2; round <= 5; round++) {
    const size = (day: string) => codeSpaceSize(specFor(day, round));
    assert.ok(size(WEEK.sat) > size(WEEK.fri), `#${round} expert > hard`);
    assert.ok(size(WEEK.fri) > size(WEEK.wed), `#${round} hard > medium`);
    assert.ok(size(WEEK.wed) > size(WEEK.mon), `#${round} medium > easy`);
  }
});

test('later vaults of a day climb the ladder one rung each, capped at 6 dials 0–9', () => {
  assert.deepEqual(shape(specFor(WEEK.mon, 2)), [3, 5, false]);
  assert.deepEqual(shape(specFor(WEEK.mon, 3)), [4, 5, false]);
  assert.deepEqual(shape(specFor(WEEK.fri, 2)), [4, 7, false]);
  assert.deepEqual(shape(specFor(WEEK.sat, 6)), [6, 9, false]);
  assert.deepEqual(shape(specFor(WEEK.sat, 99)), [6, 9, false]);
  for (const day of Object.values(WEEK)) {
    let prev = 0;
    for (let round = 1; round <= 15; round++) {
      const s = specFor(day, round);
      const size = codeSpaceSize(s);
      assert.ok(size >= prev, `${day} #${round}: ${size} < ${prev}`);
      assert.ok(s.dials <= 6 && s.maxDigit <= 9);
      prev = size;
    }
  }
  // The ladder itself strictly grows and tops out at 1 000 000 codes.
  const sizes = LEVEL_LADDER.map(codeSpaceSize);
  for (let i = 1; i < sizes.length; i++)
    assert.ok((sizes[i] ?? 0) > (sizes[i - 1] ?? 0));
  assert.equal(sizes.at(-1), 1_000_000);
});

test('specFor is deterministic and keeps the weekday', () => {
  assert.deepEqual(specFor(WEEK.fri, 3), specFor(WEEK.fri, 3));
  assert.equal(specFor(WEEK.sat, 1).weekday, 6);
});

test('each vault is named after its ladder rung (unique per rung)', () => {
  const names = LEVEL_LADDER.map((l) => l.name);
  assert.equal(new Set(names).size, LEVEL_LADDER.length);
  for (const day of Object.values(WEEK)) {
    const first = specFor(day, 1);
    const second = specFor(day, 2);
    assert.notEqual(second.name, first.name, `${day}: vault #2 reuses #1's name`);
    for (let round = 1; round <= 12; round++) {
      const s = specFor(day, round);
      const rung = LEVEL_LADDER.find(
        (l) => l.dials === s.dials && l.maxDigit === s.maxDigit && l.unique === s.unique
      );
      assert.equal(s.name, rung?.name, `${day} #${round}`);
    }
  }
  assert.equal(specFor(WEEK.tue, 1).name, 'Brass Strongbox');
  assert.equal(specFor(WEEK.tue, 2).name, 'Iron Safe');
  assert.equal(specFor(WEEK.sat, 2).name, 'Titanium Vault');
});

test('specFor rejects malformed or impossible days and rounds', () => {
  for (const bad of ['2026-11-16', '20261131', '2026111', 'abcdefgh'])
    assert.throws(() => specFor(bad, 1));
  for (const round of [0, -1, 1.5])
    assert.throws(() => specFor(WEEK.mon, round));
});

test('scoreGuess counts 🟢/🟡 only, correct for duplicate digits', () => {
  const cases: [number[], number[], number, number][] = [
    // secret, guess, exact, misplaced
    [[1, 2, 3, 4], [1, 2, 3, 4], 4, 0],
    [[1, 2, 3, 4], [4, 3, 2, 1], 0, 4],
    [[1, 2, 3, 4], [5, 6, 7, 0], 0, 0],
    [[1, 1, 2, 2], [2, 2, 1, 1], 0, 4],
    [[1, 1, 2, 3], [1, 2, 1, 1], 1, 2], // extra 1s in the guess are not double counted
    [[1, 2, 3, 4], [1, 1, 1, 1], 1, 0], // one 1 in the secret: only the exact hit counts
    [[0, 0, 0, 5], [5, 0, 0, 0], 2, 2],
    [[3, 3, 3], [3, 0, 3], 2, 0],
    [[2, 5, 2], [5, 2, 2], 1, 2],
    [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], 1, 4],
  ];
  for (const [secret, guess, exact, misplaced] of cases) {
    const fb = scoreGuess(secret, guess);
    assert.deepEqual(fb, { exact, misplaced }, `${secret} vs ${guess}`);
    // Counts only: no per-dial information in the feedback.
    assert.deepEqual(Object.keys(fb).sort(), ['exact', 'misplaced']);
  }
});

test('scoreGuess is symmetric and rejects length mismatches', () => {
  assert.deepEqual(
    scoreGuess([1, 1, 2, 3], [1, 2, 1, 1]),
    scoreGuess([1, 2, 1, 1], [1, 1, 2, 3])
  );
  assert.throws(() => scoreGuess([1, 2, 3], [1, 2]));
});

test('remainingCodes matches hand-counted small cases', () => {
  const tiny = { dials: 2, maxDigit: 2, unique: false }; // 00..22: 9 codes
  assert.equal(remainingCodes(tiny, []), 9);
  // "01" → 🟢1 🟡0: one dial right, nothing misplaced → 00, 02, 11, 21 (01 itself is 🟢2).
  assert.equal(
    remainingCodes(tiny, [{ guess: [0, 1], exact: 1, misplaced: 0 }]),
    4
  );
  // "01" → 🟢0 🟡2 leaves only 10.
  assert.equal(
    remainingCodes(tiny, [{ guess: [0, 1], exact: 0, misplaced: 2 }]),
    1
  );
  // "01" → 🟢0 🟡0: neither 0 nor 1 anywhere → 22.
  assert.equal(
    remainingCodes(tiny, [{ guess: [0, 1], exact: 0, misplaced: 0 }]),
    1
  );
  // "00" → 🟢1 🟡0 (exactly one 0): 01, 02, 10, 20. Then "12" → 🟢0 🟡1 keeps 01 and 20
  // (02 and 10 share a dial with 12 → 🟢1).
  assert.equal(
    remainingCodes(tiny, [
      { guess: [0, 0], exact: 1, misplaced: 0 },
      { guess: [1, 2], exact: 0, misplaced: 1 },
    ]),
    2
  );
  // Repeated clues count once; a no-repeat spec skips codes with repeats (3·2 = 6 codes).
  const uniq = { dials: 2, maxDigit: 2, unique: true };
  assert.equal(remainingCodes(uniq, []), 6);
  const clue = { guess: [0, 1], exact: 1, misplaced: 0 }; // 02, 21
  assert.equal(remainingCodes(uniq, [clue, clue, clue]), 2);
  // Contradictory clues leave nothing; clues of another shape are ignored.
  assert.equal(
    remainingCodes(tiny, [
      { guess: [0, 1], exact: 2, misplaced: 0 },
      { guess: [0, 1], exact: 0, misplaced: 0 },
    ]),
    0
  );
  assert.equal(
    remainingCodes(tiny, [{ guess: [0, 1, 2], exact: 0, misplaced: 0 }]),
    9
  );
});

test('remainingCodes always keeps the secret and is fast on the top rung', () => {
  const top = specFor(WEEK.sat, 6);
  const secret = [3, 1, 4, 1, 5, 9];
  const guesses = [
    [0, 0, 0, 0, 0, 0],
    [1, 2, 3, 4, 5, 6],
    [9, 9, 1, 1, 3, 3],
    [3, 1, 4, 7, 7, 7],
  ];
  const clues = guesses.map((guess) => ({
    guess,
    ...scoreGuess(secret, guess),
  }));
  const t0 = performance.now();
  const left = remainingCodes(top, clues);
  const ms = performance.now() - t0;
  assert.ok(left >= 1 && left < 1_000_000, `left ${left}`);
  assert.ok(ms < 2_000, `${ms} ms`);
});

test('parseGuess accepts digit strings and arrays that fit the spec', () => {
  const easy = specFor(WEEK.mon, 1);
  assert.deepEqual(parseGuess('044', easy), { ok: true, digits: [0, 4, 4] });
  assert.deepEqual(parseGuess([1, 2, 3], easy), {
    ok: true,
    digits: [1, 2, 3],
  });
  const deep = specFor(WEEK.sun, 6);
  assert.deepEqual(parseGuess('987659', deep), {
    ok: true,
    digits: [9, 8, 7, 6, 5, 9],
  });
});

test('parseGuess rejects wrong length, range, repeats and types', () => {
  const easy = specFor(WEEK.mon, 1);
  const hard = specFor(WEEK.fri, 2); // 4 dials, 0–7
  const noRepeat: VaultSpec = {
    ...specFor(WEEK.sat, 3),
    dials: 5,
    maxDigit: 9,
    unique: true,
  };
  const rejected = [
    parseGuess('12', easy), // too short
    parseGuess('1234', easy), // too long
    parseGuess('125', easy), // 5 > maxDigit 4
    parseGuess([0, 8, 1, 2], hard), // 8 > maxDigit 7
    parseGuess([1, 2, -1], easy),
    parseGuess([1, 2, 2.5], easy),
    parseGuess(['1', '2', '3'], easy),
    parseGuess('1 2', easy),
    parseGuess('-12', easy),
    parseGuess(123, easy),
    parseGuess(null, easy),
    parseGuess('12341', noRepeat), // repeated digit on a no-repeat spec
    parseGuess([0, 0, 1, 2, 3], noRepeat),
  ];
  for (const r of rejected) assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(parseGuess('111', easy).ok, true);
});

test('generateSecret fits every spec of the ladder; no-repeat secrets never repeat', () => {
  let seed = 7;
  const rand = (max: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };
  const specs: VaultSpec[] = [
    ...Object.values(WEEK).flatMap((day) =>
      [1, 2, 5, 9].map((r) => specFor(day, r))
    ),
    { ...specFor(WEEK.sat, 1), dials: 5, maxDigit: 9, unique: true },
  ];
  for (const spec of specs) {
    for (let i = 0; i < 100; i++) {
      const code = generateSecret(spec, rand);
      assert.equal(
        parseGuess(code, spec).ok,
        true,
        `${spec.day}#${spec.round}: ${code}`
      );
      if (spec.unique) assert.equal(new Set(code).size, code.length);
    }
  }
  assert.throws(() => generateSecret(specFor(WEEK.mon, 1), () => 99));
});

test('encodeCode/decodeCode round-trip and reject codes of another spec', () => {
  const spec = specFor(WEEK.fri, 2); // 4 dials, 0–7
  assert.equal(encodeCode([0, 4, 2, 7]), '0427');
  assert.deepEqual(decodeCode('0427', spec), [0, 4, 2, 7]);
  assert.equal(decodeCode('042', spec), null);
  assert.equal(decodeCode('0428', spec), null);
  assert.equal(decodeCode(undefined, spec), null);
});

test('guess limit: three guesses per day, the 4th is refused (no bypass)', () => {
  assert.equal(GUESSES_PER_DAY, 3);
  assert.deepEqual(guessDecision(0), { ok: true, remainingAfter: 2 });
  assert.deepEqual(guessDecision(2), { ok: true, remainingAfter: 0 });
  assert.equal(guessDecision(3).ok, false);
  assert.equal(guessDecision(4).ok, false);
  assert.equal(guessDecision(-1).ok, false);
  assert.equal(guessesLeft(0), 3);
  assert.equal(guessesLeft(5), 0);
});

const baseInput = (meta: VaultMeta, used: number, digits: number[]) => ({
  spec: specFor(WEEK.mon, 1),
  meta,
  used,
  secret: [1, 2, 3],
  digits,
  username: 'alice',
  id: 'req-00000001',
  expectedDay: WEEK.mon,
  expectedRound: meta.round,
  accountOk: true,
  nowMs: 1_000,
});

test('planGuess refuses the 4th guess and account/stale cases without scoring', () => {
  const limited = planGuess(baseInput(EMPTY_META, 3, [1, 2, 3]));
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.equal(limited.code, 'limit');

  const young = planGuess({
    ...baseInput(EMPTY_META, 0, [1, 2, 3]),
    accountOk: false,
  });
  assert.equal(!young.ok && young.code, 'account');

  const stale = planGuess({
    ...baseInput(EMPTY_META, 0, [1, 2, 3]),
    expectedRound: 2,
  });
  assert.equal(!stale.ok && stale.code, 'stale');
});

test('stale day: a request for another UTC day is refused before the limit', () => {
  assert.equal(isStaleDay(WEEK.mon, WEEK.mon), false);
  assert.equal(isStaleDay(WEEK.mon, WEEK.tue), true);
  const plan = planGuess({
    ...baseInput(EMPTY_META, 0, [1, 2, 3]),
    expectedDay: WEEK.sun,
  });
  assert.equal(!plan.ok && plan.code, 'stale');
  // Even a player out of guesses gets "stale" (no guess is used either way).
  const out = planGuess({
    ...baseInput(EMPTY_META, 3, [1, 2, 3]),
    expectedDay: WEEK.sun,
  });
  assert.equal(!out.ok && out.code, 'stale');
});

test('planGuess records a miss on the board with the request id', () => {
  const plan = planGuess(baseInput(EMPTY_META, 1, [3, 2, 0]));
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.cracked, false);
  assert.equal(plan.crack, null);
  assert.deepEqual(plan.feedback, { exact: 1, misplaced: 1 });
  assert.equal(plan.entry.seq, 1);
  assert.equal(plan.entry.id, 'req-00000001');
  assert.deepEqual(plan.meta, {
    round: 1,
    guessCount: 1,
    roundStartSeq: 0,
    roundStartMs: 0,
  });
  assert.equal(plan.remainingAfter, 1);
});

test('planGuess on a crack opens vault #N+1 and reveals the cracked code', () => {
  const meta: VaultMeta = {
    round: 2,
    guessCount: 10,
    roundStartSeq: 6,
    roundStartMs: 500,
  };
  const plan = planGuess(baseInput(meta, 0, [1, 2, 3]));
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.cracked, true);
  // The next vault's drill clock starts at the crack (nowMs).
  assert.deepEqual(plan.meta, {
    round: 3,
    guessCount: 11,
    roundStartSeq: 11,
    roundStartMs: 1_000,
  });
  assert.deepEqual(plan.crack, {
    round: 2,
    username: 'alice',
    code: [1, 2, 3],
    guesses: 5,
    atMs: 1_000,
  });
});

test('meta hash round-trips; empty is a fresh day; corrupt is refused, not reset', () => {
  const meta: VaultMeta = {
    round: 3,
    guessCount: 12,
    roundStartSeq: 9,
    roundStartMs: 1_763_400_000_000,
  };
  assert.deepEqual(parseMetaHash(metaToHash(meta)), { ok: true, meta });
  assert.deepEqual(parseMetaHash({}), { ok: true, meta: EMPTY_META });
  // Hashes written before the drill have no roundStartMs: 0 = start of the day.
  assert.deepEqual(
    parseMetaHash({ round: '3', guessCount: '12', roundStartSeq: '9' }),
    { ok: true, meta: { ...meta, roundStartMs: 0 } }
  );
  const corrupt = [
    { round: 'x', guessCount: '1', roundStartSeq: '0' },
    { round: '2', guessCount: '5' }, // missing field
    { round: '0', guessCount: '5', roundStartSeq: '0' },
    { round: '2', guessCount: '-1', roundStartSeq: '0' },
    { round: '2', guessCount: '1.5', roundStartSeq: '0' },
    { round: '2', guessCount: '3', roundStartSeq: '4' },
    { round: '2', guessCount: '3', roundStartSeq: '1', roundStartMs: '-5' },
  ];
  for (const hash of corrupt)
    assert.equal(parseMetaHash(hash).ok, false, JSON.stringify(hash));
});
