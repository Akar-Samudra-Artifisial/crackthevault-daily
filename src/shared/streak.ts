// Daily guess streak: consecutive UTC days with at least one committed guess (pure; no
// runtime imports so unit tests can load it directly).

export type Streak = {
  /** Last UTC day (yyyymmdd) the user guessed. */
  day: string;
  count: number;
};

const DAY_RE = /^\d{8}$/;

const toDate = (day: string): Date =>
  new Date(
    Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(4, 6)) - 1,
      Number(day.slice(6, 8))
    )
  );

const fromDate = (date: Date): string =>
  date.toISOString().slice(0, 10).replaceAll('-', '');

/** The UTC day before `day` (yyyymmdd). */
export const previousDay = (day: string): string => {
  const d = toDate(day);
  d.setUTCDate(d.getUTCDate() - 1);
  return fromDate(d);
};

/** Streak after guessing on `today`: same day keeps it, the next day extends it, a gap resets to 1. */
export const nextStreak = (prev: Streak | null, today: string): Streak => {
  if (!prev) return { day: today, count: 1 };
  if (prev.day === today) return prev;
  if (prev.day === previousDay(today))
    return { day: today, count: prev.count + 1 };
  return { day: today, count: 1 };
};

/** Streak to show on `today`: still alive if the last guess was today or yesterday. */
export const visibleStreak = (prev: Streak | null, today: string): number =>
  prev && (prev.day === today || prev.day === previousDay(today))
    ? prev.count
    : 0;

export const parseStreak = (raw: string | undefined | null): Streak | null => {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const day: unknown = Reflect.get(value, 'day');
  const count: unknown = Reflect.get(value, 'count');
  if (typeof day !== 'string' || !DAY_RE.test(day)) return null;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1)
    return null;
  return { day, count };
};

/** Milliseconds until the next 00:00 UTC. */
export const msUntilUtcMidnight = (nowMs: number): number => {
  const d = new Date(nowMs);
  return (
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - nowMs
  );
};
