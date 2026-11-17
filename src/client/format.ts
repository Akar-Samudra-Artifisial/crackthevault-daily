// Pure text helpers shared by splash and game.
import type { VaultSpec } from '../shared/vault';

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
  left <= 0 ? 'No tries left' : left === 1 ? '1 try left' : `${left} tries left`;

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
