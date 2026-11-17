// Pure text helpers shared by splash and game.
import { LEVEL_LADDER, type VaultSpec } from '../shared/vault';

/**
 * "Tier 9 of 9": the vault's rung on the escalation ladder (1-based). The weekday's
 * `difficulty` only describes how high the day starts, so later vaults show their tier instead.
 */
export const tierText = (
  spec: Pick<VaultSpec, 'dials' | 'maxDigit' | 'unique'>
): string => {
  const i = LEVEL_LADDER.findIndex(
    (l) =>
      l.dials === spec.dials &&
      l.maxDigit === spec.maxDigit &&
      l.unique === spec.unique
  );
  return i < 0 ? 'Tier ?' : `Tier ${i + 1} of ${LEVEL_LADDER.length}`;
};

/** "1st", "2nd", "23rd", "11th". */
export const ordinal = (n: number): string => {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
};

export const streakText = (days: number): string => `🔥 ${days}-day streak`;

export const fmtInt = (n: number): string => n.toLocaleString('en-US');

/** "X codes left": exact, "≤ X" (stale upper bound) or "…" (being computed). */
export const codesLeftText = (
  codesLeft: number | null,
  stale: boolean
): string =>
  codesLeft === null ? '…' : `${stale ? '≤ ' : ''}${fmtInt(codesLeft)}`;

export const codesLeftWord = (codesLeft: number | null): string =>
  codesLeft === 1 ? 'code left' : 'codes left';

export const specText = (spec: Pick<VaultSpec, 'dials' | 'maxDigit'>) =>
  `${spec.dials} dials · digits 0–${spec.maxDigit}`;

export const triesText = (left: number): string =>
  left <= 0
    ? 'No tries left'
    : left === 1
      ? '1 try left'
      : `${left} tries left`;

/** Server clock minus local clock (ms), from StateResponse.serverTime. */
export const clockSkew = (serverTime: string): number => {
  const t = Date.parse(serverTime);
  return Number.isFinite(t) ? t - Date.now() : 0;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "3:12:05" / "12:05" countdown. */
export const fmtClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
};

/** "5h 12m" / "12m" / "under a minute". */
export const fmtDuration = (ms: number): string => {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes < 1) return 'under a minute';
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

export const msUntilUtcMidnight = (nowMs: number): number => {
  const d = new Date(nowMs);
  return (
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - nowMs
  );
};
