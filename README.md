# Crack the Vault

A daily, community-wide code-breaking game for Reddit (Devvit Web).

Every UTC day each subreddit shares one vault with a secret code. Every player has **3 guesses
per day** (moderators too). Each guess lands on a **real-time shared clue board** with
code-breaking clues — counts only, never which dial: 🟢 = how many digits sit on the right
dial, 🟡 = how many more are in the code on another dial. The board shows how many codes are
still consistent with every clue ("X codes left"). The first player whose guess matches cracks
the vault (one cracker per vault), and vault #N+1 opens immediately — **one rung harder**.
The day's "deepest vault cracked" (and who cracked it) is the subreddit's score.

Vault #1 is the same easy rung (3 dials, 0–4) every day, so even a small subreddit cracks it.
From vault #2 the weekday decides how far the day jumps up the ladder, and every later vault
climbs one more rung (capped at the top, the most a phone dial UI holds):

| Rung | Dials | Digits | Codes     | Vault #2 on                        |
| ---- | ----- | ------ | --------- | ---------------------------------- |
| 0    | 3     | 0–4    | 125       | (vault #1, every day)              |
| 1    | 3     | 0–5    | 216       | Mon Copper Lockbox, Tue Brass Strongbox (easy) |
| 2    | 4     | 0–5    | 1 296     | Wed Steel Safe, Thu Bank Vault (medium) |
| 3    | 4     | 0–7    | 4 096     | Fri Titanium Vault (hard)          |
| 4    | 4     | 0–9    | 10 000    | Sat Royal Treasury, Sun Dragon's Hoard (expert) |
| 5    | 5     | 0–7    | 32 768    |                                    |
| 6    | 5     | 0–9    | 100 000   |                                    |
| 7    | 6     | 0–8    | 531 441   |                                    |
| 8    | 6     | 0–9    | 1 000 000 | (top, repeats)                     |

Digits may repeat on every rung. The spec is a pure function `specFor(day, round)` in
`src/shared/vault.ts`.

**The drill.** A vault nobody cracks slowly gives way: every 6 hours of its life one dial
opens publicly (position + digit), never more than dials − 1, so the last dial always has to
be guessed. Vault #1 starts when its secret is first created (normally right after 00:00 UTC;
`:start1`), vault #N+1 at the crack of vault #N. The opening
order is a random permutation (crypto) written next to the secret (`:drill:{round}`) and
never changes. The number of open dials is derived on every `/api/state` / `/api/guess`
from the round start and the clock (`src/shared/drill.ts`), never written step by step, so
concurrent requests agree and no cron is needed. `revealDials` is the only place an active
digit becomes public; players still enter all dials (the UI can pre-fill opened ones).

## Development

Requires Node ≥ 24 (`.nvmrc`).

```sh
npm install
npm run type-check   # tsc --build
npm run lint         # eslint
npm run test:unit    # node --test tests/
npm run build        # vite build → dist/client, dist/server
npm run sim          # crowd difficulty simulation (~2 min)
npm run dev          # devvit playtest (needs `npm run login`)
```

Layout: `src/shared/vault.ts` (rules, scoring, parsing), `src/shared/api.ts` (API types +
runtime parsers), `src/server` (Hono routes + Redis), `src/client` (DOM/CSS, no engine).

API: `GET /api/state`, `POST /api/guess` with `{ "guess": "0427", "day": "20261117", "round": 1 }`.
`/api/state` returns the active round's `spec`, the newest 100 clues of the active round
(`boardTotal` = all of them), `codesLeft`, `drill` (`{ revealed: [{ dial, digit }],
nextDrillAt: epoch ms | null, intervalMs }`), the newest 20 cracked vaults (`cracksTotal`) and
`deepest` (`{ day, round, username, atMs }` or null), plus `codesLeftStale` and the realtime
`channel`. Events, refetch flow and field details: [`docs/client-contract.md`](docs/client-contract.md). Deepest records are also kept per
subreddit in the `v:{sub}:deepest` hash (day → record) for the M3 leaderboard.

### "X codes left"

`remainingCodes(spec, clues, revealed)` (shared, pure) enumerates the whole code space with
an odometer, running digit counts and early exit on the first broken clue or drilled dial;
identical clues count once. The server computes it over **all** clues of the active round and
the opened dials, and caches it in `:left` per (round, clue count, open dials). On a miss only
the winner of a 5 s SET NX lock computes; concurrent requests answer at once with the older
value of the round (`codesLeftStale`) or `null` (`src/shared/codes-left.ts`). Measured on the top rung (1 000 000 codes, Node 24, laptop):
~25 ms with 1–200 real clues, ~65 ms worst seen (100–500 weak, distinct clues). The code
space never exceeds 1 000 000, so no estimate is needed.

## Simulation (difficulty tuning)

`npm run sim` (~80 s) plays whole days. Time model: each player arrives at a uniform random
moment of the 24 UTC hours and makes all 3 guesses on arrival; the drill opens a dial every
6 hours of the active vault's life (max dials − 1) and every player uses the opened dials
(the UI pre-fills them). A crack opens the next rung and restarts the drill clock. Player
model (`tools/sim/engine.ts`, `REALISTIC`): 1% solvers (guess a code consistent with every
clue), 40% casual reading only the newest clue, 10% casual reading the newest 2 clues, 49%
random valid codes. Results (30 days per cell):

| Tier (vault #2 rung) | Vaults/day (= mean deepest) 10 / 50 / 500 | Deepest max 10 / 50 / 500 | Days without a crack 10 / 50 / 500 | Dials drilled at crack 10 / 50 / 500 |
| -------------------- | ----------------------------------------- | ------------------------- | ---------------------------------- | ------------------------------------ |
| easy (3×0–5)         | 1.8 / 4.2 / 12.5                          | 3 / 6 / 17                | 3% / 0% / 0%                       | 1.00 / 0.38 / 0.05                   |
| medium (4×0–5)       | 1.6 / 3.4 / 11.1                          | 3 / 6 / 16                | 3% / 0% / 0%                       | 0.98 / 0.49 / 0.05                   |
| hard (4×0–7)         | 1.5 / 2.8 / 10.4                          | 3 / 5 / 19                | 0% / 0% / 0%                       | 1.16 / 0.64 / 0.05                   |
| expert (4×0–9)       | 1.3 / 2.7 / 9.7                           | 2 / 4 / 14                | 0% / 0% / 0%                       | 1.29 / 0.71 / 0.07                   |

10 players crack ≥ 1 vault a day on every weekday (vault #1 is easy and the drill backs it
up); 500 players reach vault #10–12; 50 players land at 2.7–4.2. From vault #2 harder
weekdays cost more guesses (`tests/vault-sim.test.ts`). Results depend heavily on
the model: a crowd where everyone deduces from every clue (`SHARP_CROWD`) cracks a vault
every ~5–7 guesses (≈22 vaults/day for 50 players), so the share of strong players is the
main unknown to re-check with real data.
