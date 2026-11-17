// API types + runtime parsers. Only `import type` from other modules: unit tests load this file
// directly with `node --test`.
import type { DrillView } from './drill';
import type {
  BoardEntry,
  CrackRecord,
  DeepestRecord,
  Difficulty,
  VaultSpec,
} from './vault';

export type ErrorResponse = {
  status: 'error';
  message: string;
};

/**
 * Public state of today's vault. Never contains the active secret: only the clue board of the
 * active round and the codes of already cracked rounds.
 */
export type StateResponse = {
  status: 'ok';
  day: string;
  spec: VaultSpec;
  /** Active vault number (1-based). */
  round: number;
  /** Guesses made today by everyone, all rounds. */
  totalGuesses: number;
  /** Newest (≤ BOARD_SEND_LIMIT) clues of the active round, oldest first. */
  board: BoardEntry[];
  /** All guesses in the active round (board may be truncated). */
  boardTotal: number;
  /**
   * Codes still consistent with every clue and opened dial of the active round ("X codes
   * left"). null while another request is computing it (show "…", refetch shortly).
   */
  codesLeft: number | null;
  /** codesLeft is from fewer clues/dials of this round (an upper bound; refetch shortly). */
  codesLeftStale: boolean;
  /** Dials of the active vault opened by the drill (only opened digits) + next opening time. */
  drill: DrillView;
  /** Realtime channel of the day (connectRealtime); messages are RealtimeEvent. */
  channel: string;
  /** Newest (≤ CRACKS_SEND_LIMIT) cracked vaults today, oldest first (codes revealed). */
  cracks: CrackRecord[];
  /** Vaults cracked today (= round - 1). */
  cracksTotal: number;
  /** Deepest vault cracked today and by whom; null before the first crack. */
  deepest: DeepestRecord | null;
  username: string | null;
  guessesUsed: number;
  guessLimit: number;
  guessesLeft: number;
  serverTime: string;
};

export type GuessRequest = {
  /** Digit string ("0427") or array of digits; validated against today's spec on the server. */
  guess: unknown;
  /** UTC day (yyyymmdd) the player was looking at; another day is refused as stale. */
  day: string;
  /** Round the player was looking at; a different active round is refused as stale. */
  round: number;
};

export type GuessRejectCode =
  'limit' | 'invalid' | 'account' | 'busy' | 'stale';

export type GuessResult = {
  guess: number[];
  exact: number;
  misplaced: number;
  cracked: boolean;
  /** Round the guess was scored in. */
  round: number;
};

export type GuessResponse =
  | { status: 'ok'; result: GuessResult; state: StateResponse }
  | {
      status: 'rejected';
      code: GuessRejectCode;
      message: string;
      state: StateResponse;
    };

/** A clue as broadcast on the realtime channel (BoardEntry without the request id). */
export type RealtimeClue = {
  seq: number;
  round: number;
  username: string;
  guess: number[];
  exact: number;
  misplaced: number;
};

/** Public snapshot of the vault that is open after the event (not per-user). */
export type ActiveVault = {
  round: number;
  /** Spec of the open vault (spec.round === round). */
  spec: VaultSpec;
  /** Guesses made today by everyone, all rounds. */
  totalGuesses: number;
  /** Guesses in the active round. */
  boardTotal: number;
  /** Same meaning as StateResponse.codesLeft / codesLeftStale. */
  codesLeft: number | null;
  codesLeftStale: boolean;
  /** Opened dials of the ACTIVE vault only (never an unopened digit). */
  drill: DrillView;
};

/**
 * Message on the day's realtime channel (`StateResponse.channel`). Public data only: never the
 * active secret; `crack.code` is the code of the round that just closed.
 * - clue: a guess missed; `round` = round of the clue.
 * - cracked: `round` was cracked by `crack.username`; `nextSpec` is vault #round+1.
 * - drill: the drill opened a dial of vault `round` (sent by the first request that sees it).
 */
export type RealtimeEvent =
  | {
      type: 'clue';
      day: string;
      round: number;
      clue: RealtimeClue;
      active: ActiveVault;
      deepest: DeepestRecord | null;
    }
  | {
      type: 'cracked';
      day: string;
      round: number;
      clue: RealtimeClue;
      crack: CrackRecord;
      nextSpec: VaultSpec;
      active: ActiveVault;
      deepest: DeepestRecord;
    }
  | { type: 'drill'; day: string; round: number; active: ActiveVault };

/** Body Devvit sends to scheduler task endpoints. */
export type TaskBody = {
  name: string;
};

/* ---------------- Runtime parsers (untrusted JSON → typed, no casts) ---------------- */

const DAY_RE = /^\d{8}$/;
const USERNAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

const prop = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;

const str = (value: unknown, key: string): string | null => {
  const v = prop(value, key);
  return typeof v === 'string' ? v : null;
};

const int = (value: unknown, key: string): number | null => {
  const v = prop(value, key);
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
};

const nonNegInt = (value: unknown, key: string): number | null => {
  const v = int(value, key);
  return v !== null && v >= 0 ? v : null;
};

/** Non-negative integer or null; undefined when missing or invalid. */
const nullableCount = (
  value: unknown,
  key: string
): number | null | undefined => {
  if (prop(value, key) === null) return null;
  const v = nonNegInt(value, key);
  return v === null ? undefined : v;
};

/** Devvit realtime channel names: letters, digits and `_` only (see src/shared/realtime.ts). */
const CHANNEL_NAME_RE = /^[A-Za-z0-9_]{1,128}$/;

const digitArray = (value: unknown): number[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10)
    return null;
  const out: number[] = [];
  for (const d of value) {
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 9)
      return null;
    out.push(d);
  }
  return out;
};

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const isDifficulty = (v: unknown): v is Difficulty =>
  v === 'easy' || v === 'medium' || v === 'hard' || v === 'expert';

const isRejectCode = (v: unknown): v is GuessRejectCode =>
  v === 'limit' ||
  v === 'invalid' ||
  v === 'account' ||
  v === 'busy' ||
  v === 'stale';

export const parseErrorResponse = (value: unknown): ErrorResponse | null => {
  const message = str(value, 'message');
  return prop(value, 'status') === 'error' && message !== null
    ? { status: 'error', message }
    : null;
};

export const parseBoardEntry = (value: unknown): BoardEntry | null => {
  const id = str(value, 'id');
  const seq = nonNegInt(value, 'seq');
  const round = nonNegInt(value, 'round');
  const username = str(value, 'username');
  const guess = digitArray(prop(value, 'guess'));
  const exact = nonNegInt(value, 'exact');
  const misplaced = nonNegInt(value, 'misplaced');
  if (
    id === null ||
    !ID_RE.test(id) ||
    seq === null ||
    round === null ||
    username === null ||
    !USERNAME_RE.test(username) ||
    !guess ||
    exact === null ||
    misplaced === null ||
    exact + misplaced > guess.length
  )
    return null;
  return { id, seq, round, username, guess, exact, misplaced };
};

export const parseCrackRecord = (value: unknown): CrackRecord | null => {
  const round = nonNegInt(value, 'round');
  const username = str(value, 'username');
  const code = digitArray(prop(value, 'code'));
  const guesses = nonNegInt(value, 'guesses');
  const atMs = nonNegInt(value, 'atMs');
  if (
    round === null ||
    username === null ||
    !USERNAME_RE.test(username) ||
    !code ||
    guesses === null ||
    atMs === null
  )
    return null;
  return { round, username, code, guesses, atMs };
};

/** Stored JSON (Redis member) → BoardEntry; null when corrupt. */
export const parseStoredBoardEntry = (raw: string): BoardEntry | null =>
  parseBoardEntry(parseJson(raw));

/** Stored JSON (Redis member) → CrackRecord; null when corrupt. */
export const parseStoredCrack = (raw: string): CrackRecord | null =>
  parseCrackRecord(parseJson(raw));

export const parseDeepestRecord = (value: unknown): DeepestRecord | null => {
  const day = str(value, 'day');
  const round = nonNegInt(value, 'round');
  const username = str(value, 'username');
  const atMs = nonNegInt(value, 'atMs');
  if (
    day === null ||
    !DAY_RE.test(day) ||
    round === null ||
    round < 1 ||
    username === null ||
    !USERNAME_RE.test(username) ||
    atMs === null
  )
    return null;
  return { day, round, username, atMs };
};

/** Stored JSON (Redis hash value) → DeepestRecord; null when corrupt. */
export const parseStoredDeepest = (raw: string): DeepestRecord | null =>
  parseDeepestRecord(parseJson(raw));

export const parseVaultSpec = (value: unknown): VaultSpec | null => {
  const day = str(value, 'day');
  const weekday = int(value, 'weekday');
  const round = int(value, 'round');
  const name = str(value, 'name');
  const difficulty = prop(value, 'difficulty');
  const dials = int(value, 'dials');
  const maxDigit = int(value, 'maxDigit');
  const unique = prop(value, 'unique');
  if (
    day === null ||
    !DAY_RE.test(day) ||
    weekday === null ||
    round === null ||
    round < 1 ||
    name === null ||
    !isDifficulty(difficulty) ||
    dials === null ||
    maxDigit === null ||
    typeof unique !== 'boolean'
  )
    return null;
  return { day, weekday, round, name, difficulty, dials, maxDigit, unique };
};

const parseList = <T>(
  value: unknown,
  item: (v: unknown) => T | null
): T[] | null => {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const raw of value) {
    const parsed = item(raw);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
};

/** Drill view of the active vault; null unless it fits `spec` (≤ dials − 1 distinct dials). */
export const parseDrillView = (
  value: unknown,
  spec: { dials: number; maxDigit: number }
): DrillView | null => {
  const revealedRaw = prop(value, 'revealed');
  const nextRaw = prop(value, 'nextDrillAt');
  const intervalMs = nonNegInt(value, 'intervalMs');
  if (!Array.isArray(revealedRaw) || revealedRaw.length > spec.dials - 1)
    return null;
  const revealed: DrillView['revealed'] = [];
  const seen = new Set<number>();
  for (const r of revealedRaw) {
    const dial = nonNegInt(r, 'dial');
    const digit = nonNegInt(r, 'digit');
    if (
      dial === null ||
      dial >= spec.dials ||
      seen.has(dial) ||
      digit === null ||
      digit > spec.maxDigit
    )
      return null;
    seen.add(dial);
    revealed.push({ dial, digit });
  }
  const nextDrillAt = nextRaw === null ? null : nonNegInt(value, 'nextDrillAt');
  if ((nextRaw !== null && nextDrillAt === null) || !intervalMs) return null;
  return { revealed, nextDrillAt, intervalMs };
};

export const parseStateResponse = (value: unknown): StateResponse | null => {
  if (prop(value, 'status') !== 'ok') return null;
  const day = str(value, 'day');
  const spec = parseVaultSpec(prop(value, 'spec'));
  const round = nonNegInt(value, 'round');
  const totalGuesses = nonNegInt(value, 'totalGuesses');
  const board = parseList(prop(value, 'board'), parseBoardEntry);
  const boardTotal = nonNegInt(value, 'boardTotal');
  const codesLeft = nullableCount(value, 'codesLeft');
  const codesLeftStale = prop(value, 'codesLeftStale');
  const drill = spec ? parseDrillView(prop(value, 'drill'), spec) : null;
  const channel = str(value, 'channel');
  const cracks = parseList(prop(value, 'cracks'), parseCrackRecord);
  const cracksTotal = nonNegInt(value, 'cracksTotal');
  const deepestRaw = prop(value, 'deepest');
  const deepest = deepestRaw === null ? null : parseDeepestRecord(deepestRaw);
  const username = prop(value, 'username');
  const guessesUsed = nonNegInt(value, 'guessesUsed');
  const guessLimit = nonNegInt(value, 'guessLimit');
  const guessesLeft = nonNegInt(value, 'guessesLeft');
  const serverTime = str(value, 'serverTime');
  if (
    day === null ||
    !DAY_RE.test(day) ||
    !spec ||
    spec.day !== day ||
    round === null ||
    spec.round !== round ||
    totalGuesses === null ||
    !board ||
    boardTotal === null ||
    codesLeft === undefined ||
    typeof codesLeftStale !== 'boolean' ||
    !drill ||
    channel === null ||
    !CHANNEL_NAME_RE.test(channel) ||
    !cracks ||
    cracksTotal === null ||
    (deepestRaw !== null && (!deepest || deepest.day !== day)) ||
    (username !== null && typeof username !== 'string') ||
    guessesUsed === null ||
    guessLimit === null ||
    guessesLeft === null ||
    serverTime === null
  )
    return null;
  return {
    status: 'ok',
    day,
    spec,
    round,
    totalGuesses,
    board,
    boardTotal,
    codesLeft,
    codesLeftStale,
    drill,
    channel,
    cracks,
    cracksTotal,
    deepest,
    username,
    guessesUsed,
    guessLimit,
    guessesLeft,
    serverTime,
  };
};

/** Server side: request body → GuessRequest (the guess itself is validated by parseGuess). */
export const parseGuessRequest = (value: unknown): GuessRequest | null => {
  const day = str(value, 'day');
  const round = int(value, 'round');
  if (day === null || !DAY_RE.test(day) || round === null || round < 1)
    return null;
  return { guess: prop(value, 'guess'), day, round };
};

const parseGuessResult = (value: unknown): GuessResult | null => {
  const guess = digitArray(prop(value, 'guess'));
  const exact = nonNegInt(value, 'exact');
  const misplaced = nonNegInt(value, 'misplaced');
  const cracked = prop(value, 'cracked');
  const round = nonNegInt(value, 'round');
  if (
    !guess ||
    exact === null ||
    misplaced === null ||
    typeof cracked !== 'boolean' ||
    round === null
  )
    return null;
  return { guess, exact, misplaced, cracked, round };
};

export const parseGuessResponse = (value: unknown): GuessResponse | null => {
  const status = prop(value, 'status');
  const state = parseStateResponse(prop(value, 'state'));
  if (!state) return null;
  if (status === 'ok') {
    const result = parseGuessResult(prop(value, 'result'));
    return result ? { status: 'ok', result, state } : null;
  }
  const message = str(value, 'message');
  const code = prop(value, 'code');
  return status === 'rejected' && message !== null && isRejectCode(code)
    ? { status: 'rejected', code, message, state }
    : null;
};

const parseRealtimeClue = (value: unknown): RealtimeClue | null => {
  const seq = nonNegInt(value, 'seq');
  const round = nonNegInt(value, 'round');
  const username = str(value, 'username');
  const guess = digitArray(prop(value, 'guess'));
  const exact = nonNegInt(value, 'exact');
  const misplaced = nonNegInt(value, 'misplaced');
  if (
    seq === null ||
    seq < 1 ||
    round === null ||
    round < 1 ||
    username === null ||
    !USERNAME_RE.test(username) ||
    !guess ||
    exact === null ||
    misplaced === null ||
    exact + misplaced > guess.length
  )
    return null;
  return { seq, round, username, guess, exact, misplaced };
};

const parseActiveVault = (value: unknown, day: string): ActiveVault | null => {
  const round = nonNegInt(value, 'round');
  const spec = parseVaultSpec(prop(value, 'spec'));
  const totalGuesses = nonNegInt(value, 'totalGuesses');
  const boardTotal = nonNegInt(value, 'boardTotal');
  const codesLeft = nullableCount(value, 'codesLeft');
  const codesLeftStale = prop(value, 'codesLeftStale');
  // Drill digits are checked against the active vault's own spec (≤ dials − 1, in range).
  const drill = spec ? parseDrillView(prop(value, 'drill'), spec) : null;
  if (
    round === null ||
    round < 1 ||
    !spec ||
    spec.round !== round ||
    spec.day !== day ||
    totalGuesses === null ||
    boardTotal === null ||
    boardTotal > totalGuesses ||
    codesLeft === undefined ||
    typeof codesLeftStale !== 'boolean' ||
    !drill
  )
    return null;
  return {
    round,
    spec,
    totalGuesses,
    boardTotal,
    codesLeft,
    codesLeftStale,
    drill,
  };
};

/**
 * Realtime message (connectRealtime onMessage) → RealtimeEvent; null for anything malformed
 * (ignore it: the next /api/state corrects any drift).
 */
export const parseRealtimeEvent = (value: unknown): RealtimeEvent | null => {
  const type = prop(value, 'type');
  const day = str(value, 'day');
  const round = nonNegInt(value, 'round');
  if (day === null || !DAY_RE.test(day) || round === null || round < 1)
    return null;
  if (type === 'drill') {
    const active = parseActiveVault(prop(value, 'active'), day);
    return active && active.round === round
      ? { type, day, round, active }
      : null;
  }
  const clue = parseRealtimeClue(prop(value, 'clue'));
  if (!clue || clue.round !== round) return null;
  if (type === 'clue') {
    const active = parseActiveVault(prop(value, 'active'), day);
    const deepestRaw = prop(value, 'deepest');
    const deepest = deepestRaw === null ? null : parseDeepestRecord(deepestRaw);
    if (
      !active ||
      active.round < round ||
      (deepestRaw !== null && (!deepest || deepest.day !== day))
    )
      return null;
    return { type, day, round, clue, active, deepest };
  }
  if (type !== 'cracked') return null;
  const crack = parseCrackRecord(prop(value, 'crack'));
  const nextSpec = parseVaultSpec(prop(value, 'nextSpec'));
  const deepest = parseDeepestRecord(prop(value, 'deepest'));
  if (
    !crack ||
    crack.round !== round ||
    crack.code.join('') !== clue.guess.join('') ||
    !nextSpec ||
    nextSpec.day !== day ||
    nextSpec.round !== round + 1 ||
    !deepest ||
    deepest.day !== day ||
    deepest.round !== round
  )
    return null;
  const active = parseActiveVault(prop(value, 'active'), day);
  if (!active || active.round <= round) return null;
  return { type, day, round, clue, crack, nextSpec, active, deepest };
};

export const parseTaskBody = (value: unknown): TaskBody | null => {
  const name = str(value, 'name');
  return name === null ? null : { name };
};
