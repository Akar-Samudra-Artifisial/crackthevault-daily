// The opened code as shown in the crack overlay (pure; unit tests load this file directly).

/** One digit plate of the revealed code: position-keyed, so repeated digits (3 2 2, 0 0 0) all show. */
export type CodeCell = { index: number; digit: string };

/** Every digit in order, one cell each; never deduplicated or sorted. */
export const codeCells = (code: readonly number[]): CodeCell[] =>
  code.map((d, index) => ({ index, digit: String(d) }));

/** Accessible name of the code row: "The code was 3 2 2". */
export const codeLabel = (code: readonly number[]): string =>
  `The code was ${code.join(' ')}`;
