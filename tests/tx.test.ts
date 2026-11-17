import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUESS_TX_ATTEMPTS,
  execFailureOutcome,
  isExecAborted,
  retryDelayMs,
} from '../src/shared/tx.ts';

test('isExecAborted: empty/absent reply = aborted, any reply = committed', () => {
  // Shapes produced by @devvit/redis TxClient.exec(): one entry per queued command.
  assert.equal(isExecAborted([]), true);
  assert.equal(isExecAborted(null), true);
  assert.equal(isExecAborted(undefined), true);
  assert.equal(isExecAborted({ response: [] }), true);
  assert.equal(isExecAborted([1, 'OK', 1, null]), false);
  assert.equal(isExecAborted([null]), false);
});

test('retry backoff grows, has bounded jitter and stays well under a second in total', () => {
  assert.equal(
    retryDelayMs(1, () => 0),
    15
  );
  assert.equal(
    retryDelayMs(2, () => 0),
    30
  );
  assert.equal(
    retryDelayMs(1, () => 0.999),
    39
  );
  assert.equal(
    retryDelayMs(1, () => 5),
    40
  ); // random clamped to [0, 1]
  let worst = 0;
  for (let a = 1; a < GUESS_TX_ATTEMPTS; a++)
    worst += retryDelayMs(a, () => 0.999999);
  assert.ok(worst < 1000, `worst total ${worst} ms`);
});

test('exec failure: our entry on the board means committed (never write twice)', () => {
  assert.equal(
    execFailureOutcome({ ownEntryOnBoard: true, metaChanged: true }),
    'committed'
  );
  assert.equal(
    execFailureOutcome({ ownEntryOnBoard: true, metaChanged: false }),
    'committed'
  );
  assert.equal(
    execFailureOutcome({ ownEntryOnBoard: false, metaChanged: true }),
    'conflict'
  );
  assert.equal(
    execFailureOutcome({ ownEntryOnBoard: false, metaChanged: false }),
    'error'
  );
});
