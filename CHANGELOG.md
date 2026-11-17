# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- M1: Devvit Web scaffold (Vite, Hono, TypeScript project references, ESLint, CI workflow).
- Vault rules in `src/shared/vault.ts`: code-breaking clues as counts only (🟢 right dial,
  🟡 other dial, never per dial; correct for duplicate digits), guess parsing, secret
  generation, 3-guesses-per-day limit (no moderator bypass).
- Realtime (M2 server): after a committed guess `POST /api/guess` publishes a public
  `RealtimeEvent` (`clue` / `cracked`) on `vault_{sub}_{day}` (`StateResponse.channel`); the
  first request that sees a newly drilled dial publishes `drill`. Publish failures are logged
  and never fail the guess. Typed parser `parseRealtimeEvent`; client contract in
  `docs/client-contract.md`.
- Per-vault escalation: `specFor(day, round)` on a 9-rung ladder — vault #1 is 3×0–4 every
  day; vault #2 jumps to the weekday's rung (easy 3×0–5, medium 4×0–5, hard 4×0–7, expert
  4×0–9) and each later vault climbs one rung, up to 6 dials 0–9. Tuned with the crowd
  simulation (README).
- The drill: an uncracked vault opens one dial (position + digit) publicly every 6 hours since
  it started (vault #1 at 00:00 UTC, vault #N+1 at the previous crack), at most dials − 1.
  Random crypto opening order stored next to the secret; open count derived lazily from the
  round start on every request (no cron, race-free). `StateResponse.drill` sends only opened
  digits plus `nextDrillAt`; `VaultMeta.roundStartMs` records the round start.
- "X codes left": pure `remainingCodes(spec, clues, revealed)`; `/api/state` sends `codesLeft`
  for the active round (server-side, cached per clue count and opened dials).
- Daily "deepest vault cracked": `StateResponse.deepest` (round + cracker), also stored per
  subreddit per day (`v:{sub}:deepest`) for the upcoming leaderboard.
- `GET /api/state`: today's spec, active round, clue board, cracked vaults and the player's
  remaining guesses; never includes the active secret.
- `POST /api/guess`: server-side validation, account age ≥ 3 days (fail-open), WATCH/MULTI
  transaction so only one player cracks each round and the limit holds under concurrency;
  a crack opens vault #N+1 with a new secret the same day.
- Daily post creation (cron, install trigger, moderator menu) deduplicated per UTC day.
- Unit tests and a crowd simulation (`npm run sim`: 10/50/500 players × weekday tier, mixed
  player model) for difficulty tuning.
- `GuessRequest.day`: a guess for another UTC day is refused as `stale` without using a guess.
- `StateResponse.boardTotal` / `cracksTotal`; `/api/state` sends at most the newest 100 clues
  of the active round and the newest 20 cracked vaults.
- M2 client UI (plain DOM + CSS, flat cartoon vault look, system rounded font, no new
  dependencies): inline splash with the vault door, "Vault #N · theme", codes left, last crack,
  your tries and a "Crack it" button (~9 KB gzip incl. CSS); expanded game with the shared clue
  board as the main view ("X codes left" with "…"/"≤ X", live clues sliding in, your tries
  highlighted, aria-live announcements), header with spec, drill countdown and deepest vault,
  and a dial dock (tap ▲/▼, drag, or keyboard; drilled dials locked and pre-filled).
- The open-vault moment on every crack (realtime `cracked`, your own crack, or a crack missed
  while polling): the wheel spins, the door swings open, the code flips in, confetti, then
  vault #N+1; respects `prefers-reduced-motion`.
- Client follows `docs/client-contract.md`: realtime with seq dedupe and out-of-order guard,
  refetch at `nextDrillAt`, ~2 s refetch for null/stale codes left, 30 s polling while
  realtime is down, refetch at 00:00 UTC; friendly messages for every rejection code.
- Local UI preview with mock data (`npm run preview:ui`, `tools/preview/`), not part of the
  production build.

### Changed

- Cracked vaults are stored in their own `:cracks` zset (written only on a crack) instead of a
  JSON list inside `:meta`.
- Lint and type-check now cover `tests/` and `tools/`.

### Fixed

- A guess whose EXEC threw after committing is no longer recorded twice on retry (each request
  carries a unique id that is checked on the board first).
- WATCH conflict retries use exponential backoff with jitter (< 1 s total).
- A corrupt `:meta` hash is logged and answered with a generic 500 instead of silently
  resetting the day to vault #1.
- A missing secret for round > 1 is an error instead of being re-rolled; the WATCH/MULTI is
  released when an error happens before EXEC.
- "X codes left" is single-flight: on a cache miss only the winner of a 5 s SET NX lock per
  (round, clues, drilled) runs `remainingCodes`; concurrent requests get the older value of
  the round flagged `codesLeftStale` or `codesLeft: null` instead of all recomputing.
- Vault #1's drill clock starts when its secret is first created (`:start1`), not at 00:00
  UTC, so a late post does not open dials before anyone played (older days keep 00:00).
- Game client: snapshots are merged in order (`mergeState` in `src/shared/client-state.ts`) —
  a late `/api/state` or guess response no longer removes realtime clues (board = union by
  seq), never gives back a used try, and an earlier vault/day is ignored.
- Game client: a failed guess request refetches the state; the "codes left" refetch backs off
  (2→32 s, max 5 per condition); an overdue drill time retries after 10 s+ instead of every
  second; malformed realtime messages refetch at most every 10 s; callbacks of a left channel
  are ignored. A new UTC day refetches and starts clean without a crack celebration.
- Game client: the open-vault overlay no longer closes by itself after 9 s (button / Escape);
  the first clue of a new vault animates in; `VaultGame.dispose()` stops timers, listeners and
  the realtime subscription.
- 6-dial vaults fit 320 px screens with ≥ 44 px dial buttons; preview scenario `maxdials`.
