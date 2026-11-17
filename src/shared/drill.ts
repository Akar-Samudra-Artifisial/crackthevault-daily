// The drill: an uncracked vault opens one dial (position + digit) publicly every 6 hours since
// the vault started, never more than dials − 1. Pure and time-based: the reveal count is
// derived from (startMs, nowMs) on every read, never written step by step, so concurrent
// requests always agree. Only `import type` from other modules (unit tests load this file).
import type { DialReveal, RandomInt } from './vault';

export const DRILL_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Public drill state of the active vault (no unrevealed digit ever appears here). */
export type DrillView = {
  /** Opened dials, in opening order. */
  revealed: DialReveal[];
  /** Epoch ms when the next dial opens; null when dials − 1 are already open. */
  nextDrillAt: number | null;
  intervalMs: number;
};

/** 00:00 UTC of a yyyymmdd day, epoch ms (vault #1 starts then). */
export const dayStartMs = (day: string): number =>
  Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8))
  );

/** Dials open at `nowMs` for a vault of `dials` started at `startMs`: 0 … dials − 1. */
export const drillCount = (
  dials: number,
  startMs: number,
  nowMs: number
): number => {
  const elapsed = Math.floor((nowMs - startMs) / DRILL_INTERVAL_MS);
  return Math.max(0, Math.min(elapsed, dials - 1));
};

export const nextDrillAt = (
  dials: number,
  startMs: number,
  nowMs: number
): number | null => {
  const count = drillCount(dials, startMs, nowMs);
  return count >= dials - 1 ? null : startMs + (count + 1) * DRILL_INTERVAL_MS;
};

/** Random opening order of the dial positions (Fisher–Yates; server passes crypto randomInt). */
export const generateDrillOrder = (
  dials: number,
  randomInt: RandomInt
): number[] => {
  const order = Array.from({ length: dials }, (_, i) => i);
  for (let i = dials - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i)
      throw new Error(`randomInt(${i + 1}) returned ${j}`);
    const a = order[i] ?? i;
    order[i] = order[j] ?? j;
    order[j] = a;
  }
  return order;
};

export const encodeDrillOrder = (order: readonly number[]): string =>
  order.join('');

/** Stored order → positions; null unless it is a permutation of 0 … dials − 1. */
export const decodeDrillOrder = (
  raw: string | null | undefined,
  dials: number
): number[] | null => {
  if (typeof raw !== 'string' || raw.length !== dials || !/^\d+$/.test(raw))
    return null;
  const order = [...raw].map(Number);
  const seen = new Set(order);
  return seen.size === dials && order.every((p) => p < dials) ? order : null;
};

/**
 * The only place a digit of an active secret becomes public: the first `count` positions of
 * the opening order, with `count` capped at dials − 1 so the full code never opens.
 */
export const revealDials = (
  secret: readonly number[],
  order: readonly number[],
  count: number
): DialReveal[] => {
  const n = Math.max(0, Math.min(count, secret.length - 1, order.length));
  const out: DialReveal[] = [];
  for (const dial of order.slice(0, n)) {
    const digit = secret[dial];
    if (digit === undefined)
      throw new Error(`drill order position ${dial} outside the code`);
    out.push({ dial, digit });
  }
  return out;
};

/** Drill state of a vault at `nowMs`. */
export const drillView = (input: {
  secret: readonly number[];
  order: readonly number[];
  startMs: number;
  nowMs: number;
}): DrillView => {
  const dials = input.secret.length;
  return {
    revealed: revealDials(
      input.secret,
      input.order,
      drillCount(dials, input.startMs, input.nowMs)
    ),
    nextDrillAt: nextDrillAt(dials, input.startMs, input.nowMs),
    intervalMs: DRILL_INTERVAL_MS,
  };
};
