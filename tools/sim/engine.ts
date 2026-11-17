// Fast crowd simulation engine (flat typed arrays). Used by vault-sim.ts and its tests.

export type Level = { dials: number; maxDigit: number; unique: boolean };

export type Rng = () => number;

/** Deterministic PRNG (mulberry32) so runs are reproducible. */
export const mulberry32 = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type Space = { level: Level; n: number; codes: Uint8Array };

const spaces = new Map<string, Space>();

/** Every valid code of a level, flat (n × dials digits). Cached. */
export const spaceFor = (level: Level): Space => {
  const key = `${level.dials}:${level.maxDigit}:${level.unique}`;
  const hit = spaces.get(key);
  if (hit) return hit;
  const base = level.maxDigit + 1;
  const total = base ** level.dials;
  const out = new Uint8Array(total * level.dials);
  const cur = new Uint8Array(level.dials);
  let n = 0;
  for (let i = 0; i < total; i++) {
    let x = i;
    for (let d = level.dials - 1; d >= 0; d--) {
      cur[d] = x % base;
      x = Math.floor(x / base);
    }
    if (level.unique && new Set(cur).size !== level.dials) continue;
    out.set(cur, n * level.dials);
    n++;
  }
  const space = { level, n, codes: out.subarray(0, n * level.dials) };
  spaces.set(key, space);
  return space;
};

type Clue = {
  g: Uint8Array;
  gTot: Int32Array;
  exact: number;
  misplaced: number;
};

const tmp = new Int32Array(10);

/** Packed feedback (exact * 16 + misplaced) of guess `clue.g` against code `i`. */
const feedbackAt = (
  space: Space,
  i: number,
  g: Uint8Array,
  gTot: Int32Array
): number => {
  const k = space.level.dials;
  const off = i * k;
  tmp.fill(0);
  let exact = 0;
  for (let p = 0; p < k; p++) {
    const c = space.codes[off + p] ?? 0;
    if (c === g[p]) exact++;
    tmp[c] = (tmp[c] ?? 0) + 1;
  }
  let common = 0;
  for (let d = 0; d < 10; d++) common += Math.min(tmp[d] ?? 0, gTot[d] ?? 0);
  return exact * 16 + (common - exact);
};

const fits = (
  space: Space,
  i: number,
  clues: readonly Clue[],
  from: number
): boolean => {
  for (let c = from; c < clues.length; c++) {
    const cl = clues[c];
    if (!cl) continue;
    if (feedbackAt(space, i, cl.g, cl.gTot) !== cl.exact * 16 + cl.misplaced)
      return false;
  }
  return true;
};

const codeAt = (space: Space, i: number): Uint8Array =>
  space.codes.slice(i * space.level.dials, (i + 1) * space.level.dials);

const totals = (g: Uint8Array): Int32Array => {
  const t = new Int32Array(10);
  for (const d of g) t[d] = (t[d] ?? 0) + 1;
  return t;
};

/**
 * Player model (one type per player per day, 3 guesses in a row):
 * - sharp: guesses a code consistent with ALL clues of the active vault (a solver-minded
 *   player using the board and the "codes left" counter);
 * - casual: guesses a code consistent with the newest `memory` clues only (what a person
 *   keeps in mind / sees on screen);
 * - random: any valid code (first-timers, curious taps) — the share left over.
 */
export type Model = {
  sharp: number;
  casual: readonly { memory: number; share: number }[];
};

/** Default crowd: 1% solvers, 50% casual (40% read 1 clue, 10% read 2), 49% random. */
export const REALISTIC: Model = {
  sharp: 0.01,
  casual: [
    { memory: 1, share: 0.4 },
    { memory: 2, share: 0.1 },
  ],
};
/** Upper bound: everybody deduces from every clue. */
export const SHARP_CROWD: Model = { sharp: 1, casual: [] };

/** Player kind: -1 = sharp, 0 = random, n > 0 = casual with memory n. */
const pickKind = (model: Model, r: number): number => {
  if (r < model.sharp) return -1;
  let acc = model.sharp;
  for (const c of model.casual) {
    acc += c.share;
    if (r < acc) return c.memory;
  }
  return 0;
};

/** The drill opens one dial every 6 hours of a vault's life, at most dials − 1. */
export const DRILL_INTERVAL_H = 6;
const DAY_H = 24;

type VaultRun = {
  space: Space;
  secret: number;
  clues: Clue[];
  /** Sim hour the vault started (vault #1: 0, next: hour of the previous crack). */
  startH: number;
  /** Random dial opening order. */
  order: number[];
  /** Dials open right now (first `open` entries of `order`). */
  open: number;
  cands: Int32Array | null;
  candsUpTo: number;
  candsOpen: number;
};

const pickIndex = (rng: Rng, n: number): number => Math.floor(rng() * n);

const newVault = (level: Level, rng: Rng, startH: number): VaultRun => {
  const space = spaceFor(level);
  const order = Array.from({ length: level.dials }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = pickIndex(rng, i + 1);
    const a = order[i] ?? i;
    order[i] = order[j] ?? j;
    order[j] = a;
  }
  return {
    space,
    secret: pickIndex(rng, space.n),
    clues: [],
    startH,
    order,
    open: 0,
    cands: null,
    candsUpTo: 0,
    candsOpen: 0,
  };
};

/** Does code `i` show the secret's digit on every open dial? */
const fitsOpen = (v: VaultRun, i: number): boolean => {
  const k = v.space.level.dials;
  for (let o = 0; o < v.open; o++) {
    const p = v.order[o] ?? 0;
    if (v.space.codes[i * k + p] !== v.space.codes[v.secret * k + p])
      return false;
  }
  return true;
};

const sharpGuess = (v: VaultRun, rng: Rng): number => {
  if (!v.cands) {
    const out: number[] = [];
    for (let i = 0; i < v.space.n; i++)
      if (fitsOpen(v, i) && fits(v.space, i, v.clues, 0)) out.push(i);
    v.cands = Int32Array.from(out);
  } else if (v.candsUpTo < v.clues.length || v.candsOpen < v.open) {
    const out: number[] = [];
    for (const i of v.cands)
      if (fitsOpen(v, i) && fits(v.space, i, v.clues, v.candsUpTo)) out.push(i);
    v.cands = Int32Array.from(out);
  }
  v.candsUpTo = v.clues.length;
  v.candsOpen = v.open;
  return v.cands[pickIndex(rng, v.cands.length)] ?? v.secret;
};

const REJECTION_TRIES = 20_000;

/**
 * A uniform code with the open dials filled in (the UI pre-fills them). Repeat-allowed spaces
 * are full base^dials grids, so the index is built digit by digit; no-repeat spaces fall back
 * to rejection sampling.
 */
const randomOpenCode = (v: VaultRun, rng: Rng): number => {
  const { level } = v.space;
  if (v.open === 0) return pickIndex(rng, v.space.n);
  if (!level.unique) {
    const base = level.maxDigit + 1;
    const k = level.dials;
    const digits = new Int32Array(k);
    for (let p = 0; p < k; p++) digits[p] = pickIndex(rng, base);
    for (let o = 0; o < v.open; o++) {
      const p = v.order[o] ?? 0;
      digits[p] = v.space.codes[v.secret * k + p] ?? 0;
    }
    let idx = 0;
    for (let p = 0; p < k; p++) idx = idx * base + (digits[p] ?? 0);
    return idx;
  }
  for (let t = 0; t < REJECTION_TRIES; t++) {
    const i = pickIndex(rng, v.space.n);
    if (fitsOpen(v, i)) return i;
  }
  return sharpGuess(v, rng);
};

/**
 * Uniform over codes consistent with the open dials and the newest `memory` clues (rejection
 * sampling). In the rare case that fails, it falls back to a code consistent with all clues:
 * slightly stronger than the model says, so results err on the "vaults fall faster" side.
 */
const casualGuess = (v: VaultRun, rng: Rng, memory: number): number => {
  const from = Math.max(0, v.clues.length - memory);
  for (let t = 0; t < REJECTION_TRIES; t++) {
    const i = randomOpenCode(v, rng);
    if (fits(v.space, i, v.clues, from)) return i;
  }
  return sharpGuess(v, rng);
};

export type DayOptions = {
  levelFor: (round: number) => Level;
  players: number;
  model: Model;
  rng: Rng;
  guessesPerPlayer?: number;
  stopAfterCracks?: number;
  /**
   * Time model (default true): players arrive uniformly over the 24 UTC hours and make all
   * their guesses on arrival; the drill opens a dial every DRILL_INTERVAL_H hours of a
   * vault's life. False = no clock, no drill (pure guess-count model).
   */
  timed?: boolean;
};

export type DayResult = {
  totalGuesses: number;
  cracks: number;
  /** Deepest vault cracked (0 = none). */
  deepest: number;
  guessesPerCrack: number[];
  /** Dials the drill had opened when each vault was cracked. */
  openAtCrack: number[];
};

export const simulateDay = (opts: DayOptions): DayResult => {
  const { rng, model } = opts;
  const per = opts.guessesPerPlayer ?? 3;
  const timed = opts.timed ?? true;
  const arrivals = new Float64Array(timed ? opts.players : 0);
  if (timed) {
    for (let p = 0; p < opts.players; p++) arrivals[p] = rng() * DAY_H;
    arrivals.sort();
  }
  let round = 1;
  let vault = newVault(opts.levelFor(round), rng, 0);
  let roundGuesses = 0;
  let total = 0;
  const guessesPerCrack: number[] = [];
  const openAtCrack: number[] = [];
  const result = (deepest: number): DayResult => ({
    totalGuesses: total,
    cracks: guessesPerCrack.length,
    deepest,
    guessesPerCrack,
    openAtCrack,
  });
  for (let p = 0; p < opts.players; p++) {
    const t = arrivals[p] ?? 0;
    const kind = pickKind(model, rng());
    for (let g = 0; g < per; g++) {
      if (timed) {
        const steps = Math.floor((t - vault.startH) / DRILL_INTERVAL_H);
        vault.open = Math.max(0, Math.min(steps, vault.space.level.dials - 1));
      }
      const idx =
        kind < 0
          ? sharpGuess(vault, rng)
          : kind > 0
            ? casualGuess(vault, rng, kind)
            : randomOpenCode(vault, rng);
      const guess = codeAt(vault.space, idx);
      const gTot = totals(guess);
      const fb = feedbackAt(vault.space, vault.secret, guess, gTot);
      total++;
      roundGuesses++;
      if (fb >> 4 === vault.space.level.dials) {
        guessesPerCrack.push(roundGuesses);
        openAtCrack.push(vault.open);
        if (
          opts.stopAfterCracks !== undefined &&
          guessesPerCrack.length >= opts.stopAfterCracks
        )
          return result(round);
        round++;
        vault = newVault(opts.levelFor(round), rng, t);
        roundGuesses = 0;
        continue;
      }
      vault.clues.push({ g: guess, gTot, exact: fb >> 4, misplaced: fb & 15 });
    }
  }
  return result(round - 1);
};

/** Mean guesses to crack one vault of `level` (unlimited players, no clock, no drill). */
export const meanGuessesToCrack = (
  level: Level,
  trials: number,
  model: Model,
  rng: Rng
): number => {
  let sum = 0;
  for (let t = 0; t < trials; t++) {
    const r = simulateDay({
      levelFor: () => level,
      players: 1_000_000,
      model,
      rng,
      stopAfterCracks: 1,
      timed: false,
    });
    sum += r.guessesPerCrack[0] ?? 0;
  }
  return sum / trials;
};
