// The few text helpers the feed splash needs. Kept apart from format.ts (no imports) so the
// splash bundle stays tiny; format.ts re-exports them for the game.

export const fmtInt = (n: number): string => n.toLocaleString('en-US');

export const streakText = (days: number): string => `🔥 ${days}-day streak`;

/** "X codes left": exact, "≤ X" (stale upper bound) or "…" (being computed). */
export const codesLeftText = (
  codesLeft: number | null,
  stale: boolean
): string =>
  codesLeft === null ? '…' : `${stale ? '≤ ' : ''}${fmtInt(codesLeft)}`;

export const codesLeftWord = (codesLeft: number | null): string =>
  codesLeft === 1 ? 'code left' : 'codes left';

export const triesText = (left: number): string =>
  left <= 0
    ? 'No tries left'
    : left === 1
      ? '1 try left'
      : `${left} tries left`;
