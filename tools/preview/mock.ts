// Local-only mock of /api/state, /api/guess and the realtime channel (docs/client-contract.md),
// for the UI preview. Never part of the production build (Vite only builds src/client/*.html).
import type {
  ActiveVault,
  GuessResponse,
  RealtimeEvent,
  StateResponse,
} from '../../src/shared/api';
import type {
  LeaderboardResponse,
  MyStanding,
} from '../../src/shared/safecracker';
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
  | 'maxdials'
  | 'drillsoon';

const SCENARIOS: readonly Scenario[] = [
  'maxdials',
  'drillsoon',
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

/** `?code=322` → [3, 2, 2] (digits only, 1–10 long); anything else → null. */
const forcedCode = (): number[] | null => {
  const raw = new URLSearchParams(window.location.search).get('code') ?? '';
  return /^\d{1,10}$/.test(raw) ? [...raw].map(Number) : null;
};

/** /api/leaderboard mock: `?lb=full|empty|error` (default: empty for `s=empty`, else full). */
export type LeaderboardMode = 'full' | 'top' | 'empty' | 'error';

const leaderboardModeFromUrl = (scenario: Scenario): LeaderboardMode => {
  const raw = new URLSearchParams(window.location.search).get('lb');
  if (raw === 'full' || raw === 'top' || raw === 'empty' || raw === 'error')
    return raw;
  return scenario === 'empty' ? 'empty' : 'full';
};

const TOP_CREW: readonly [string, number][] = [
  ['keymaster_9', 41],
  ['tumbler_tom', 33],
  ['vaultrat', 29],
  ['dialtone', 18],
  ['brassmonkey', 15],
  ['mintcondition', 11],
  ['quietcracker', 9],
  ['lukewarm_toast', 7],
  ['the_long_dial_of_the_law', 6],
  ['pinpusher', 5],
];

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
  Array.from({ length: 12 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');

export const createMock = (scenario: Scenario) => {
  const roundStart = Date.now() - 2 * HOUR;
  // maxdials: vault #9 on 2026-11-17 is the top LEVEL_LADDER rung (6 dials, 0–9).
  let round = scenario === 'empty' ? 1 : scenario === 'maxdials' ? 9 : 6;
  const codeFor = (r: number, salt: number): number[] => {
    const s = specFor(DAY, r);
    return Array.from(
      { length: s.dials },
      (_, i) => (i * 3 + salt) % (s.maxDigit + 1)
    );
  };
  let secret = round === 6 ? [6, 2, 7, 4, 1] : codeFor(round, 5);
  // cracked + `&code=322`: crack the first vault of the day whose spec fits that code
  // (repeated digits, 000, 6 dials …) to check the overlay's code row.
  const forced = forcedCode();
  if (scenario === 'cracked' && forced) {
    const fit = Array.from({ length: 12 }, (_, i) => i + 1).find((r) => {
      const s = specFor(DAY, r);
      return (
        s.dials === forced.length &&
        forced.every((d) => d <= s.maxDigit) &&
        (!s.unique || new Set(forced).size === forced.length)
      );
    });
    if (fit !== undefined) {
      round = fit;
      secret = forced;
    }
  }
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
  // drillsoon: the next dial opens 20 s after load (chip pulses under 1 min, then a clunk).
  let nextDrillAt: number | null =
    scenario === 'drill'
      ? Date.now() + 5 * HOUR + 47 * 60_000
      : scenario === 'drillsoon'
        ? Date.now() + 20_000
        : Date.now() + 3 * HOUR + 12 * 60_000;
  let guessesUsed = scenario === 'limit' ? 3 : scenario === 'empty' ? 0 : 2;
  const username = scenario === 'loggedout' ? null : ME;
  let staleOnce = scenario === 'stale';
  const listeners: RealtimeHandlers[] = [];

  const spec = () => specFor(DAY, round);
  const push = (who: string, guess: number[]): BoardEntry => {
    const fb = scoreGuess(secret, guess);
    const entry: BoardEntry = {
      id: randomId(),
      seq: ++seq,
      round,
      username: who,
      guess,
      ...fb,
    };
    board.push(entry);
    return entry;
  };
  if (round > 1) {
    // Seeded guesses fit the open vault: padded/cut to its dials, digits kept in range.
    const { dials, maxDigit } = spec();
    for (const s of SEEDED) {
      const guess = Array.from(
        { length: dials },
        (_, i) => (s.guess[i] ?? i) % (maxDigit + 1)
      );
      push(s.who, guess);
    }
  }

  const codesLeft = () => remainingCodes(spec(), board, revealed);

  const state = (): StateResponse => {
    // Like the server: a drill time that has passed opens the next closed dial lazily.
    if (
      nextDrillAt !== null &&
      Date.now() >= nextDrillAt &&
      revealed.length < spec().dials - 1
    ) {
      const dial = [2, 0, 4, 1, 3, 5].find(
        (d) => d < spec().dials && !revealed.some((r) => r.dial === d)
      );
      if (dial !== undefined)
        revealed = [...revealed, { dial, digit: secret[dial] ?? 0 }];
      nextDrillAt = Date.now() + 6 * HOUR;
    }
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
      drill: {
        revealed: revealed.map((r) => ({ ...r })),
        nextDrillAt,
        intervalMs: 6 * HOUR,
      },
      channel: `vault_t5_preview_${DAY}`,
      cracks: cracks.map((c) => ({ ...c, code: [...c.code] })),
      cracksTotal: cracks.length,
      deepest: last
        ? {
            day: DAY,
            round: last.round,
            username: last.username,
            atMs: last.atMs,
          }
        : null,
      username,
      guessesUsed,
      guessLimit: 3,
      guessesLeft: Math.max(0, 3 - guessesUsed),
      streak: 2,
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
      secret = Array.from(
        { length: specFor(DAY, round).dials },
        (_, i) => (i * 3 + 1) % 8
      );
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
        deepest: {
          day: DAY,
          round: crack.round,
          username: who,
          atMs: crack.atMs,
        },
        crackerStreak: who === ME ? 3 : 6,
        crackerCracks: cracks.filter((c) => c.username === who).length + 40,
      });
      return { entry, cracked: true };
    }
    const st = state();
    emit({
      type: 'clue',
      day: DAY,
      round: entry.round,
      clue,
      active: active(),
      deepest: st.deepest,
    });
    return { entry, cracked: false };
  };

  const lbMode = leaderboardModeFromUrl(scenario);

  const leaderboard = (): LeaderboardResponse => {
    const empty = lbMode === 'empty';
    const today = empty ? null : state().deepest;
    const crackers = empty
      ? []
      : cracks.slice(-20).map((c) => ({ ...c, code: [...c.code] }));
    const me: MyStanding | null = username
      ? empty
        ? { username, cracks: 0, rank: null, streak: 0 }
        : lbMode === 'top'
          ? { username, cracks: 7, rank: 8, streak: 2 }
          : { username, cracks: 3, rank: 14, streak: 2 }
      : null;
    // `top`: you are 8th, so your row is highlighted inside the top 10.
    const crew = TOP_CREW.map(([name, n]): [string, number] =>
      lbMode === 'top' && username && name === 'lukewarm_toast'
        ? [username, n]
        : [name, n]
    );
    return {
      status: 'ok',
      day: DAY,
      today,
      record: empty
        ? null
        : {
            day: '20261103',
            round: 11,
            username: 'keymaster_9',
            atMs: Date.now() - 14 * 24 * HOUR,
          },
      crackers,
      crackersTotal: empty ? 0 : cracks.length,
      top: empty
        ? []
        : crew.map(([name, n], i) => ({
            rank: i + 1,
            username: name,
            cracks: n,
          })),
      me,
    };
  };

  const backend: Backend = {
    fetchState: async () => state(),
    fetchLeaderboard: async () => {
      await new Promise((r) => window.setTimeout(r, 450));
      if (lbMode === 'error') throw new Error('mock: leaderboard unavailable');
      return leaderboard();
    },
    postGuess: async (_st, raw): Promise<GuessResponse> => {
      await new Promise((r) => window.setTimeout(r, 350));
      if (!username || guessesUsed >= 3)
        return {
          status: 'rejected',
          code: 'limit',
          message: 'limit',
          state: state(),
        };
      const guess = [...raw].map(Number);
      guessesUsed++;
      const playedRound = round;
      const { entry, cracked } = play(username, guess);
      return {
        status: 'ok',
        result: {
          guess,
          exact: entry.exact,
          misplaced: entry.misplaced,
          cracked,
          round: playedRound,
        },
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
      const who = new URLSearchParams(window.location.search).has('me')
        ? ME
        : 'keymaster_9';
      window.setTimeout(() => play(who, [...secret]), 900);
    }
    if (scenario === 'live') {
      let i = 0;
      window.setInterval(() => {
        const who = CROWD[i % CROWD.length] ?? 'vaultrat';
        const max = spec().maxDigit;
        const guess = Array.from({ length: spec().dials }, () =>
          Math.floor(Math.random() * (max + 1))
        );
        if (guess.join('') !== secret.join('')) play(who, guess);
        i++;
      }, 2500);
    }
  };

  return { backend, state, script };
};
