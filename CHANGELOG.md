# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- M4: "Crack the Vault" wordmark (`/brand/logo.webp`, lazy-loaded) in the game header in place
  of the door badge; the splash stays image-free.
- M4: synthesised sound effects in the game view (Web Audio, no audio files): dial tick,
  code sent, clue chime (rising notes per 🟢, lower per 🟡, a falling pair for a blank clue),
  quieter chime for other players' realtime clues, drill clunk and vault bolts + chime. Sound
  starts only after the first tap/key, at low volume; the 🔊/🔇 header button remembers the
  choice in `localStorage`. The feed splash stays silent.
- M4: light animations (transform/opacity only, off with `prefers-reduced-motion`): digits
  roll in the direction the dial turned, a freshly drilled dial pops, blank clues shake their
  pegs, 🟢 pegs pop with a green halo, your own new clue gets a brass ring, the drill chip
  pulses in the last minute and the splash vault door idles.
- M4: judge-facing README (how to play, fair play, tech, development).
- M1: Devvit Web scaffold (Vite, Hono, TypeScript project references, ESLint, CI workflow).
- Vault rules in `src/shared/vault.ts`: code-breaking clues as counts only (🟢 right dial,
  🟡 other dial, never per dial; correct for duplicate digits), guess parsing, secret
  generation, 3-guesses-per-day limit (no moderator bypass).
- M3 server: after a crack the app gives the cracker the "Safecracker of the Day 🔓" user
  flair (taken from the previous holder only if they still wear it) and comments
  "u/X cracked vault #N (<name>) in K guesses 🔓" with the cracked code on the day's post;
  both best effort and once per (day, round) via SET NX. The flair holder is claimed in a
  WATCH/MULTI by crack order `(day, round)` before calling Reddit (a stale reward revokes its
  own flair); the cracker's previous flair is saved and restored when the flair moves on;
  failed removals are queued per subreddit and retried on later rewards; a failed flair or
  comment drops its marker and is retried from `/api/state` (max 3 attempts).
- Leaderboard: all-time record kept in `v:{sub}:record` by the crack transaction (no scan of
  the per-day hash); shared part cached 15 s per subreddit, invalidated on a crack.

### Changed

- M4: the feed splash loads with its own light `/api/state` reader (still validated), so its
  JS + CSS shrink from 10,357 B to about 8.4 KB gzip; the game view is unchanged.
- M4: your own new clue highlights with a fading ring instead of an animated box shadow.

### Security

- Crack comments escape `&`, `<`, `>` and `@` besides markdown control characters; flair
  holder parsing accepts every valid Reddit username (same pattern as the API parser).
- Client: own realtime clues are deduped by a bounded own-seq set (not only the 100-clue
  board); the celebration says "u/X is today's Safecracker" instead of promising the flair.
- Guess streak (consecutive UTC days with a committed guess), updated in the guess
  transaction; `StateResponse.streak`.
- `GET /api/leaderboard` (`parseLeaderboardResponse`): today's deepest vault + all-time
  record, today's newest 20 crackers, top 10 safecrackers all-time (crack-count zset, no
  TTL), and the caller's cracks/rank/streak. The `cracked` event carries `crackerStreak` and
  `crackerCracks`.
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
- M3 UI: the 🏆 chip opens a leaderboard sheet (deepest vault today + all-time record, today's
  cracks, top 10 safecrackers with your row highlighted, your place and streak) with loading,
  empty and error/retry states; it refreshes when a vault is cracked while it is open, and
  closes with ✕, Escape or a backdrop tap, returning focus to the chip.
- M3 UI: your "🔥 N-day streak" in the game view and on the feed splash.
- M3 UI: the crack overlay names the "Safecracker of the Day 🔓" and shows the cracker's streak
  and crack count.
- Preview: `?lb=full|top|empty|error` mocks for the leaderboard sheet.

### Changed

- The game header and splash show the vault's tier ("Tier 9 of 9") instead of the weekday
  difficulty word.
- On screens ≤ 360 px the header, clue rows and dials are slimmer so the clue board shows
  at least 4 rows at 320×568.

- Cracked vaults are stored in their own `:cracks` zset (written only on a crack) instead of a
  JSON list inside `:meta`.
- Lint and type-check now cover `tests/` and `tools/`.

### Fixed

- The clue board showed only one row in Reddit's Mobile and Desktop expanded view (the webview
  is only ~596 px tall). On screens ≤ 700 px tall the header, codes counter, clue rows and dials
  are slimmer, so the board shows at least 3 rows there; below 480 px the page scrolls and the
  board keeps a fixed height.
- With the game open in two tabs, a guess in one tab now lowers the tries left in the other
  (from the realtime clue), never below 0.
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
