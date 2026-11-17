// Crowd simulation for Crack the Vault difficulty tuning.
// Run: npm run sim   (the engine is also imported by tests/vault-sim.test.ts)
//
// One simulated day: players arrive at uniform random times over the 24 UTC hours, each makes
// GUESSES_PER_DAY guesses in a row against the active vault; a crack opens vault #N+1 (next
// ladder rung, fresh board, drill clock restarts). The drill opens one dial of the active vault
// every 6 hours of its life (max dials − 1); every player kind uses the opened dials.
// Player model: see `Model` in ./engine.ts (REALISTIC = default crowd).

import { GUESSES_PER_DAY, specFor } from '../../src/shared/vault.ts';
import {
  REALISTIC,
  SHARP_CROWD,
  mulberry32,
  simulateDay,
  type Model,
  type Rng,
} from './engine.ts';

/** One representative UTC day per weekday tier (2026-11-16 is a Monday). */
export const TIER_DAYS = {
  'easy (Mon–Tue)': '20261116',
  'medium (Wed–Thu)': '20261118',
  'hard (Fri)': '20261120',
  'expert (Sat–Sun)': '20261121',
} as const;

export type TierRow = {
  tier: string;
  players: number;
  /** Mean vaults cracked per day. */
  cracks: number;
  /** Mean / max deepest vault cracked. */
  deepestMean: number;
  deepestMax: number;
  /** Mean guesses per cracked vault. */
  guessesPerVault: number;
  /** Share of days (0–1) with no vault cracked. */
  noCrackDays: number;
  /** Mean dials the drill had opened when a vault was cracked. */
  openAtCrack: number;
};

export const levelForDay = (day: string) => (round: number) =>
  specFor(day, round);

export const simulateTier = (
  tier: string,
  day: string,
  players: number,
  days: number,
  model: Model,
  rng: Rng
): TierRow => {
  let cracks = 0;
  let deepest = 0;
  let deepestMax = 0;
  let crackGuesses = 0;
  let noCrack = 0;
  let open = 0;
  for (let i = 0; i < days; i++) {
    const r = simulateDay({
      levelFor: levelForDay(day),
      players,
      model,
      rng,
      guessesPerPlayer: GUESSES_PER_DAY,
    });
    cracks += r.cracks;
    deepest += r.deepest;
    deepestMax = Math.max(deepestMax, r.deepest);
    crackGuesses += r.guessesPerCrack.reduce((a, b) => a + b, 0);
    if (r.cracks === 0) noCrack++;
    open += r.openAtCrack.reduce((a, b) => a + b, 0);
  }
  return {
    tier,
    players,
    cracks: cracks / days,
    deepestMean: deepest / days,
    deepestMax,
    guessesPerVault: cracks > 0 ? crackGuesses / cracks : Number.NaN,
    noCrackDays: noCrack / days,
    openAtCrack: cracks > 0 ? open / cracks : Number.NaN,
  };
};

const table = (
  name: string,
  model: Model,
  days: number,
  seed: number,
  crowds: readonly number[]
): void => {
  const rng = mulberry32(seed);
  console.log(`\n${name} — ${days} simulated days per cell`);
  console.log(
    'tier'.padEnd(18),
    'players',
    ' vaults/day',
    ' deepest(mean/max)',
    ' guesses/vault',
    ' no-crack days',
    ' drilled@crack'
  );
  for (const [tier, day] of Object.entries(TIER_DAYS)) {
    for (const players of crowds) {
      const r = simulateTier(tier, day, players, days, model, rng);
      console.log(
        tier.padEnd(18),
        String(players).padStart(7),
        r.cracks.toFixed(1).padStart(11),
        `${r.deepestMean.toFixed(1)}/${r.deepestMax}`.padStart(18),
        (Number.isNaN(r.guessesPerVault)
          ? '-'
          : r.guessesPerVault.toFixed(0)
        ).padStart(14),
        `${(r.noCrackDays * 100).toFixed(0)}%`.padStart(14),
        (Number.isNaN(r.openAtCrack) ? '-' : r.openAtCrack.toFixed(2)).padStart(
          14
        )
      );
    }
  }
};

const isMain = process.argv[1]?.endsWith('vault-sim.ts') ?? false;
if (isMain) {
  table(
    'REALISTIC crowd (1% solvers, 50% casual, 49% random)',
    REALISTIC,
    30,
    1,
    [10, 50, 500]
  );
  // 500 sharp players would crack ~1500 / 7 vaults a day; skipped to keep the run short.
  table(
    'SHARP crowd (everyone deduces from every clue; upper bound)',
    SHARP_CROWD,
    10,
    2,
    [10, 50]
  );
}
