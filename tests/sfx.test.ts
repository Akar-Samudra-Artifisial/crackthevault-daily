import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MASTER_VOLUME,
  OTHER_CLUE_GAIN,
  acquireVoice,
  clueNotes,
  parseMuted,
  visibilityAction,
} from '../src/shared/sfx.ts';

test('visibilityAction: suspend when hidden, resume on return only when sound is on', () => {
  assert.equal(visibilityAction(false, false), 'suspend');
  assert.equal(visibilityAction(false, true), 'suspend');
  assert.equal(visibilityAction(true, false), 'resume');
  assert.equal(visibilityAction(true, true), null);
});

test('mute preference: only "1" mutes, default is sound on', () => {
  assert.equal(parseMuted('1'), true);
  assert.equal(parseMuted('0'), false);
  assert.equal(parseMuted(null), false);
  assert.equal(parseMuted('true'), false);
});

test('volumes stay low', () => {
  assert.ok(MASTER_VOLUME > 0 && MASTER_VOLUME <= 0.5);
  assert.ok(OTHER_CLUE_GAIN > 0 && OTHER_CLUE_GAIN < 1);
});

test('clueNotes: blank falls, greens rise, capped at 6', () => {
  const blank = clueNotes(0, 0);
  assert.equal(blank.length, 2);
  assert.ok((blank[1]?.freq ?? 0) < (blank[0]?.freq ?? 0));

  const greens = clueNotes(3, 0);
  assert.equal(greens.length, 3);
  for (let i = 1; i < greens.length; i++)
    assert.ok((greens[i]?.freq ?? 0) > (greens[i - 1]?.freq ?? 0));

  const mixed = clueNotes(1, 2);
  assert.equal(mixed.length, 3);
  // Yellow notes are lower than the green one and come after it.
  assert.ok((mixed[1]?.freq ?? 0) < (mixed[0]?.freq ?? 0));
  assert.ok((mixed[1]?.delayS ?? 0) > (mixed[0]?.delayS ?? 0));

  assert.equal(clueNotes(6, 6).length, 6);
  assert.equal(clueNotes(-2, Number.NaN).length, 2);
  // Many greens sound brighter than none.
  const top = (n: ReturnType<typeof clueNotes>) =>
    Math.max(...n.map((x) => x.freq));
  assert.ok(top(clueNotes(4, 0)) > top(clueNotes(0, 0)));
});

test('acquireVoice limits polyphony and drops finished voices', () => {
  assert.deepEqual(acquireVoice([], 0, 0.5, 2), [0.5]);
  assert.equal(acquireVoice([1, 1], 0, 0.5, 2), null);
  assert.deepEqual(acquireVoice([0.2, 1], 0.5, 0.5, 2), [1, 1]);
  assert.equal(acquireVoice([1], 0, 0.5, 2, 2), null);
  assert.deepEqual(acquireVoice([], 0, 0.1, 4, 3), [0.1, 0.1, 0.1]);
});
