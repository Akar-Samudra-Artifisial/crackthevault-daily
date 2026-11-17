import assert from 'node:assert/strict';
import test from 'node:test';
import { codeCells, codeLabel } from '../src/shared/crack-code.ts';

const digits = (code: number[]) => codeCells(code).map((c) => c.digit);

test('codeCells keeps every digit in order, repeats included', () => {
  assert.deepEqual(digits([3, 2, 2]), ['3', '2', '2']);
  assert.deepEqual(digits([0, 0, 0]), ['0', '0', '0']);
  assert.deepEqual(digits([9, 0, 9, 0, 9, 0]), ['9', '0', '9', '0', '9', '0']);
});

test('codeCells indexes by position (stable, unique keys)', () => {
  const cells = codeCells([7, 7, 7, 7, 7, 7]);
  assert.equal(cells.length, 6);
  assert.deepEqual(
    cells.map((c) => c.index),
    [0, 1, 2, 3, 4, 5]
  );
});

test('codeLabel reads every digit', () => {
  assert.equal(codeLabel([3, 2, 2]), 'The code was 3 2 2');
  assert.equal(codeLabel([0, 0, 0]), 'The code was 0 0 0');
});
