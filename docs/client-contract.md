# Client contract (M2)

What the game client (`src/client`) can rely on. Types and runtime parsers live in
`src/shared/api.ts`; always parse untrusted JSON with them (`parseStateResponse`,
`parseGuessResponse`, `parseRealtimeEvent`) instead of casting. Malformed data → ignore it and
refetch `/api/state`.

## Endpoints

| Call | Body | Returns |
| ---- | ---- | ------- |
| `GET /api/state` | — | `StateResponse` (or `ErrorResponse`, HTTP 500) |
| `POST /api/guess` | `{ "guess": "0427", "day": state.day, "round": state.round }` | `GuessResponse` (`ok` or `rejected`, both with a fresh `state`); `ErrorResponse` for 400/401/413/500 |

Rejection codes: `limit` (3 guesses per UTC day used, all rounds), `invalid` (does not fit
`spec`), `account` (account too new), `busy` (retry), `stale` (another day or round is open:
show the new `state`). A rejected guess never costs a guess.

## `StateResponse` fields

- `day` (yyyymmdd UTC), `spec` (`round`, `name`, `difficulty`, `dials`, `maxDigit`, `unique`)
  and `round` of the **open** vault.
- `board` (newest ≤ 100 clues of the open vault, oldest first; `boardTotal` = all of them).
  Clue = `{ id, seq, round, username, guess, exact 🟢, misplaced 🟡 }`. Counts only, never
  per dial.
- `codesLeft: number | null` + `codesLeftStale: boolean` — "X codes left" for every clue and
  opened dial of the open vault:
  - number, not stale → exact;
  - number, stale → an older value of this vault (an upper bound): show "≤ X", refetch in ~2 s;
  - `null` → another request is computing it: show "…", refetch in ~2 s.
- `drill: { revealed: [{ dial, digit }], nextDrillAt: epoch ms | null, intervalMs }` — dials of
  the open vault opened by the drill (one per 6 h of the vault's life, never all of them).
  Pre-fill / lock those dials in the input; the guess still sends every dial.
  `nextDrillAt: null` → no more dials will open.
- `channel` — realtime channel of the day (pass to `connectRealtime`).
- `cracks` (newest ≤ 20 cracked vaults `{ round, username, code, guesses, atMs }`,
  `cracksTotal`), `deepest` (`{ day, round, username, atMs }` or null).
- Per player: `username` (null when logged out), `guessesUsed`, `guessLimit`, `guessesLeft`.
- `serverTime` (ISO) — use `Date.parse(serverTime) - Date.now()` as clock skew for countdowns.

The active secret is never in any response or event; only codes of cracked vaults are.

## Realtime events (`connectRealtime({ channel: state.channel, onMessage })`)

Every message is a `RealtimeEvent` (check with `parseRealtimeEvent`). Each carries `day`,
`round` (the vault the event is about) and `active` — a public snapshot of the vault open
**after** the event: `{ round, spec, totalGuesses, boardTotal, codesLeft, codesLeftStale,
drill }` (no per-player fields).

| `type` | Extra fields | Client action |
| ------ | ------------ | ------------- |
| `clue` | `clue { seq, round, username, guess, exact, misplaced }`, `deepest` | If `clue.round === state.round` and `clue.seq` is new, append it to the board; apply `active` if `active.round === state.round`. |
| `cracked` | `clue` (the cracking guess), `crack` (closed round incl. its `code`), `nextSpec` (vault #round+1), `deepest` | Celebrate `crack.username` and show `crack.code`; then refetch `/api/state` (new vault, fresh board, your `guessesLeft`). |
| `drill` | — | Apply `active.drill` / `codesLeft` if `active.round === state.round`, else refetch. |

Rules:
- `day !== state.day` or `active.round > state.round` (missed a crack) → refetch `/api/state`.
- Apply `active` only when `active.totalGuesses >= state.totalGuesses` (events may arrive out
  of order); never lower `totalGuesses`.
- Your own guess also comes back as an event: dedupe clues by `seq`.
- `guessesLeft` is never in an event: it only changes through your own `/api/guess` response.

## Refetch flow

1. On open: `GET /api/state`, then `connectRealtime` on `state.channel` (reconnect when
   `channel` changes, e.g. after 00:00 UTC).
2. Realtime events keep the board live (see table).
3. **Drill is lazy** (no cron): schedule one `GET /api/state` at `drill.nextDrillAt` (+ ~1 s,
   corrected for skew). The first request that sees a newly opened dial also broadcasts a
   `drill` event, so other clients usually get it without waiting.
4. `codesLeft === null` or `codesLeftStale` → one refetch after ~2 s.
5. Fallback when realtime is not connected (`onDisconnect`, or `isRealtimeConnected(channel)`
   false): poll `GET /api/state` every 30 s while the page is visible (stop when hidden,
   refetch on `visibilitychange` to visible). Stop polling once realtime reconnects.
6. At 00:00 UTC (from `serverTime`) refetch: a new day/vault starts.
