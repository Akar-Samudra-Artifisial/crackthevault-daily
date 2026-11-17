// Local-only mock of /api/state, /api/guess and the realtime channel (docs/client-contract.md),
// for the UI preview. Never part of the production build (Vite only builds src/client/*.html).
import type {
  ActiveVault,
  GuessResponse,
  RealtimeEvent,
  StateResponse,
} from '../../src/shared/api';
import type { Backend, RealtimeHandlers } from '../../src/client/game-app';
import {
  remainingCodes,
  scoreGuess,
  specFor,
  type BoardEntry,
  type CrackRecord,
  type DialReveal,
} from '../../src/shared/vault';

export type Scenario =
  | 'board'
  | 'drill'
  | 'cracked'
  | 'limit'
  | 'empty'
  | 'live'
  | 'loggedout'
  | 'stale'
  | 'maxdials';

const SCENARIOS: readonly Scenario[] = [
  'maxdials',
  'board',
  'drill',
  'cracked',
  'limit',
  'empty',
  'live',
  'loggedout',
  'stale',
];

export const scenarioFromUrl = (): Scenario => {
  const raw = new URLSearchParams(window.location.search).get('s');
  return SCENARIOS.find((s) => s === raw) ?? 'board';
};

const DAY = '20261117';
const ME = 'safe_hands';
const HOUR = 3_600_000;
const CROWD = [
  'vaultrat',
  'mintcondition',
  'lukewarm_toast',
  'dialtone',
  'brassmonkey',
  'keymaster_9',
  'quietcracker',
  'tumbler_tom',
];

/** Vault #6 on 2026-11-17 is 5 dials, digits 0–7. */
const SEEDED: { who: string; guess: number[] }[] = [
  { who: 'vaultrat', guess: [0, 0, 0, 1, 1] },
  { who: 'mintcondition', guess: [2, 2, 3, 3, 3] },
  { who: ME, guess: [4, 4, 5, 5, 5] },
  { who: 'lukewarm_toast', guess: [6, 6, 6, 7, 7] },
  { who: 'dialtone', guess: [0, 1, 0, 1, 0] },
  { who: 'brassmonkey', guess: [2, 3, 2, 3, 2] },
  { who: ME, guess: [3, 3, 3, 3, 3] },
  { who: 'quietcracker', guess: [5, 5, 1, 1, 0] },
];

const randomId = () =>
  Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export const createMock = (scenario: Scenario) => {
  const roundStart = Date.now() - 2 * HOUR;
  // maxdials: vault #9 on 2026-11-17 is the top LEVEL_LADDER rung (6 dials, 0–9).
  let round = scenario === 'empty' ? 1 : scenario === 'maxdials' ? 9 : 6;
  const codeFor = (r: number, salt: number): number[] => {
    const s = specFor(DAY, r);
    return Array.from({ length: s.dials }, (_, i) => (i * 3 + salt) % (s.maxDigit + 1));
  };
  let secret = round === 6 ? [6, 2, 7, 4, 1] : codeFor(round, 5);
  let seq = 20;
  let board: BoardEntry[] = [];
  const cracks: CrackRecord[] = Array.from({ length: round - 1 }, (_, i) => ({
    round: i + 1,
    username: CROWD[(i * 3) % CROWD.length] ?? 'vaultrat',
    code: codeFor(i + 1, i + 1),
    guesses: 9 + i * 3,
    atMs: roundStart - (round - 1 - i) * HOUR,
  }));
  let revealed: DialReveal[] =
    scenario === 'drill' ? [{ dial: 1, digit: secret[1] ?? 0 }] : [];
  let nextDrillAt: number | null =
    scenario === 'drill' ? Date.now() + 5 * HOUR + 47 * 60_000 : Date.now() + 3 * HOUR + 12 * 60_000;
  let guessesUsed = scenario === 'limit' ? 3 : scenario === 'empty' ? 0 : 2;
  const username = scenario === 'loggedout' ? null : ME;
  let staleOnce = scenario === 'stale';
  const listeners: RealtimeHandlers[] = [];

  const spec = () => specFor(DAY, round);
  const push = (who: string, guess: number[]): BoardEntry => {
    const fb = scoreGuess(secret, guess);
    const entry: BoardEntry = { id: randomId(), seq: ++seq, round, username: who, guess, ...fb };
    board.push(entry);
    return entry;
  };
  if (round > 1) {
    // Seeded guesses fit the open vault: padded/cut to its dials, digits kept in range.
    const { dials, maxDigit } = spec();
    for (const s of SEEDED) {
      const guess = Array.from({ length: dials }, (_, i) => (s.guess[i] ?? i) % (maxDigit + 1));
      push(s.who, guess);
    }
  }

  const codesLeft = () =>
    remainingCodes(spec(), board, revealed);

  const state = (): StateResponse => {
    const stale = staleOnce;
    staleOnce = false;
    const last = cracks[cracks.length - 1];
    return {
      status: 'ok',
      day: DAY,
      spec: spec(),
      round,
      totalGuesses: seq - 20 + 30,
      board: board.map((b) => ({ ...b, guess: [...b.guess] })),
      boardTotal: board.length,
      codesLeft: stale ? 74 : codesLeft(),
      codesLeftStale: stale,
      drill: { revealed: revealed.map((r) => ({ ...r })), nextDrillAt, intervalMs: 6 * HOUR },
      channel: `vault_t5_preview_${DAY}`,
      cracks: cracks.map((c) => ({ ...c, code: [...c.code] })),
      cracksTotal: cracks.length,
      deepest: last ? { day: DAY, round: last.round, username: last.username, atMs: last.atMs } : null,
      username,
      guessesUsed,
      guessLimit: 3,
      guessesLeft: Math.max(0, 3 - guessesUsed),
      serverTime: new Date().toISOString(),
    };
  };

  const active = (): ActiveVault => {
    const st = state();
    return {
      round: st.round,
      spec: st.spec,
      totalGuesses: st.totalGuesses,
      boardTotal: st.boardTotal,
      codesLeft: st.codesLeft,
      codesLeftStale: st.codesLeftStale,
      drill: st.drill,
    };
  };

  const emit = (ev: RealtimeEvent) => {
    const raw: unknown = JSON.parse(JSON.stringify(ev));
    for (const l of listeners) l.onMessage(raw);
  };

  /** Someone (or you) tries a code; returns the clue and whether it cracked. */
  const play = (who: string, guess: number[]) => {
    const entry = push(who, guess);
    const clue = {
      seq: entry.seq,
      round: entry.round,
      username: who,
      guess: [...guess],
      exact: entry.exact,
      misplaced: entry.misplaced,
    };
    if (entry.exact === spec().dials) {
      const crack: CrackRecord = {
        round,
        username: who,
        code: [...secret],
        guesses: board.length,
        atMs: Date.now(),
      };
      cracks.push(crack);
      round++;
      secret = Array.from({ length: specFor(DAY, round).dials }, (_, i) => (i * 3 + 1) % 8);
      board = [];
      revealed = [];
      nextDrillAt = Date.now() + 6 * HOUR;
      emit({
        type: 'cracked',
        day: DAY,
        round: crack.round,
        clue,
        crack,
        nextSpec: spec(),
        active: active(),
        deepest: { day: DAY, round: crack.round, username: who, atMs: crack.atMs },
      });
      return { entry, cracked: true };
    }
    const st = state();
    emit({ type: 'clue', day: DAY, round: entry.round, clue, active: active(), deepest: st.deepest });
    return { entry, cracked: false };
  };

  const backend: Backend = {
    fetchState: async () => state(),
    postGuess: async (_st, raw): Promise<GuessResponse> => {
      await new Promise((r) => window.setTimeout(r, 350));
      if (!username || guessesUsed >= 3)
        return { status: 'rejected', code: 'limit', message: 'limit', state: state() };
      const guess = [...raw].map(Number);
      guessesUsed++;
      const playedRound = round;
      const { entry, cracked } = play(username, guess);
      return {
        status: 'ok',
        result: { guess, exact: entry.exact, misplaced: entry.misplaced, cracked, round: playedRound },
        state: state(),
      };
    },
    connect: (_channel, handlers) => {
      listeners.push(handlers);
      window.setTimeout(() => handlers.onConnect(), 50);
    },
    disconnect: () => {},
    toast: (text) => {
      const el = document.createElement('div');
      el.className = 'preview-toast';
      el.textContent = text;
      document.body.append(el);
      window.setTimeout(() => el.remove(), 2600);
    },
  };

  /** Scripted events per scenario (after the first render). */
  const script = () => {
    if (scenario === 'cracked') {
      window.setTimeout(() => play('keymaster_9', [...secret]), 900);
    }
    if (scenario === 'live') {
      let i = 0;
      window.setInterval(() => {
        const who = CROWD[i % CROWD.length] ?? 'vaultrat';
        const max = spec().maxDigit;
        const guess = Array.from({ length: spec().dials }, () => Math.floor(Math.random() * (max + 1)));
        if (guess.join('') !== secret.join('')) play(who, guess);
        i++;
      }, 2500);
    }
  };

  return { backend, state, script };
};
