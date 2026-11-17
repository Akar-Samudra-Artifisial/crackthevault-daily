# Devpost write-up — Crack the Vault

Draft for Reddit's Game of the Day Hackathon 2026 (second submission). Target submit: 6 Dec. Every claim below is taken from `README.md`, `AGENTS.md`, `CHANGELOG.md` and `src/shared/*`. Anything not known yet is marked `[TODO: ...]`.

## Project overview

**Project name:** Crack the Vault

**Elevator pitch (≤200 chars):**

One vault per subreddit per day. Three tries each, and every guess is a public clue. Crack it together, then a harder vault opens.

## About the project (Markdown)

## Inspiration

Reddit is at its best when a crowd works something out together: a thread where one person posts a hunch, the next builds on it, and the answer falls out of the comments. We wanted a game with that shape. Not a solo puzzle you finish alone, but one secret code that a whole subreddit has to deduce, where every guess is a contribution everyone else can read and use.

## What it does

Crack the Vault is a daily, community-wide code-breaking game that lives inside a Reddit post.

- **One vault per subreddit per day.** A new vault post appears at 00:00 UTC. Everyone in the subreddit is working on the same secret code.
- **Three tries per player per day.** Moderators too, with no bypass. Three tries can't brute-force a vault, so you have to read the crowd.
- **Counts-only clues.** Each try is scored with 🟢 (a digit on the right dial) and 🟡 (a digit in the code, but on another dial). You only get counts, never which dial is right.
- **A shared, real-time clue board.** Every try from every player lands on one board that updates live while you watch. The board also shows how many codes are still possible ("X codes left").
- **The drill.** A vault nobody cracks slowly gives way: every 6 hours one dial is drilled open for everyone, up to dials minus one. The last dial is never drilled, so someone still has to guess it.
- **Crack it and go deeper.** The first player whose code matches cracks the vault, and vault #N+1 opens immediately and is harder. There are 9 difficulty tiers. Vault #1 is 3 dials with digits 0–4, and the top tier is 6 dials of 0–9.
- **Fame on Reddit.** The cracker gets the user flair "Safecracker of the Day 🔓", and the app comments on the day's post: "u/X cracked vault #N (name) in K guesses 🔓" with the code that was cracked.
- **Come back tomorrow.** A 🔥 streak of consecutive UTC days with at least one try, and a leaderboard: today's deepest vault, the subreddit's all-time deepest, today's crackers, the top 10 safecrackers of all time and your own rank.
- **In the feed.** The inline splash is plain DOM and CSS, about 8.4 KB gzip (JS + CSS), so the post loads fast. The game opens in expanded mode.

The tension is social: three tries are not enough alone, but they are enough if you read everyone else's clues first.

### For moderators

A new vault post is created automatically every day at 00:00 UTC. Moderators can also use the subreddit menu **Create today's vault**.

## How we built it

- **Devvit Web** for the app: `splash.html` (feed view) and `game.html` (expanded view), written in plain TypeScript, DOM and CSS, built with Vite. No game engine.
- **Hono** routes on the Devvit server (`/api/state`, `/api/guess`, `/api/leaderboard`, plus scheduler, trigger and menu endpoints).
- **Redis** for secrets, clues, limits, streaks and records, using WATCH/MULTI transactions.
- **Devvit realtime** with one channel per subreddit and day: new clues, drilled dials and cracks reach every open game instantly. The client falls back to polling when disconnected.
- **Reddit API and scheduler** for the daily post (cron at 00:00 UTC), the flair and the crack comment.
- **Web Audio** for sound effects synthesised at runtime (dial tick, clue chime, drill clunk, vault bolts), with no audio files. Sound starts only after the first tap and has a 🔊/🔇 button.
- **AI-assisted brand art.** The app icon, banner and wordmark were generated with Runware image models and then post-processed. The game itself is code-only, and the splash has no images.

## Challenges we ran into

- **Fair play on a shared secret.** The active code lives only in Redis and is never sent to a client. Drilled dials are derived on the server from the round's start time. Every guess is validated on the server, and the try limit and the crack run inside one Redis transaction, so there is exactly one cracker per vault even if two players submit the same code at the same moment. Accounts must be at least 3 days old to try codes; watching is open to everyone.
- **Difficulty that works for any community size.** A vault that is too hard never falls, and one that is too easy is boring. We built a crowd simulation (1% strong solvers, 50% casual players reading the newest clues, 49% random codes) and used it to tune a 9-tier ladder and the 6-hour drill. In the simulation, 10 players crack at least one vault a day on every weekday and 500 players reach vault #10–12. The share of strong players is the main unknown, and we will re-check it with real data.
- **"X codes left" without lag.** The server enumerates the whole code space against all clues. On the top tier (1,000,000 codes) it takes about 25 ms. The result is cached, and only one request recomputes at a time.
- **A drill with no cron.** The number of open dials is derived on every request from the round start and the clock, never written step by step, so concurrent requests agree.

## Accomplishments that we're proud of

- A full daily loop: a new vault every day, three tries each, a streak to keep and a Safecracker to remember.
- A crowd really can solve it. The shared clue board turns three tries per person into something a community can finish together, and a cracked vault leads straight to a harder one.
- A very light feed splash, about 8.4 KB gzip, and fully synthesised sound with no audio files.
- Light animations (digits rolling, a drilled dial popping, 🟢 pegs with a halo) that respect `prefers-reduced-motion`.

## What we learned

Counts-only feedback is a small rule with a big effect: it keeps each clue useful but never decisive, so players have to combine clues. Most of our time went into server-side fairness (one cracker, a hard try limit, a secret that never leaves the server) and into tuning the difficulty with simulation.

## What's next for Crack the Vault

- Re-tune the difficulty ladder and the drill with real player data.
- More statistics per player and per subreddit.
- Weekly events and themed vaults.

## Built with

devvit, reddit, hono, redis, typescript, vite, web-audio-api, runware

## Try it out links

- App: https://developers.reddit.com/apps/crackthevault-daily
- Demo subreddit: https://www.reddit.com/r/crackthevault_dev
- Demo post: https://www.reddit.com/r/crackthevault_dev/comments/1xygldv/crack_the_vault_brass_strongbox_20261117/
- A new vault is posted daily at 00:00 UTC at r/crackthevault_dev; the newest post is today's vault.
- GitHub repo: https://github.com/Akar-Samudra-Artifisial/crackthevault-daily

## Video demo link

https://youtu.be/gKDegcfmW3E

## Additional info (judges only)

- Reddit username: yhoyoex, Impossible-Solid2650
- developers.reddit.com app page: https://developers.reddit.com/apps/crackthevault-daily
- Link to test post: https://www.reddit.com/r/crackthevault_dev/comments/1xygldv/crack_the_vault_brass_strongbox_20261117/ (a new vault is posted daily at 00:00 UTC; the newest post in r/crackthevault_dev is today's vault)
- Ported game: No
- Port link (required even when "No"): N/A (not a port; original game built for this hackathon)
- Sponsor / Special Prizes: [TODO: decide, same options as submission 1]
- AI use: brand art (icon, banner, wordmark) made with Runware image models; game logic and code are our own.

Gallery: [TODO: choose images from real playtest stills, in this order: thumbnail, feed splash, dials + guess, clue board, drill, crack + flair/comment, leaderboard]

---

## Video script (≤60 s, from real playtest footage)

Rules: record the real playtest (`npm run dev` on r/crackthevault_dev) with two accounts, one per browser tab or window. No mock data, no `preview:ui`. Voice-over is short and calm; captions on. Total 58 s.

| Time | Shot (real footage) | Voice-over |
| ---- | ------------------- | ---------- |
| 0:00–0:05 | Reddit feed, the vault splash post scrolls into view, then tap **Crack it**. | "One vault. One subreddit. Three tries each." |
| 0:05–0:15 | Game opens. Set dials with ▲/▼ and send a code. The 🟢🟡 clue appears on the board. | "Every try gives you counts only: green, right dial. Yellow, wrong dial." |
| 0:15–0:27 | Split view: tab 2 (second account) sends a code; the new clue appears live in tab 1 and the "X codes left" count drops. | "Every try becomes a public clue, live for everyone. Read the crowd." |
| 0:27–0:36 | The drill chip, then a dial opens by itself (the drill). Note: a dial opens every 6 hours, so use a recorded moment from a real drill, or from a vault whose round started about 6 h earlier. | "Nobody cracks it? Every six hours, a dial drills open." |
| 0:36–0:46 | Enter the winning code. The crack overlay and vault bolts play, then show the Reddit flair "Safecracker of the Day 🔓" and the auto-comment on the post. | "Crack it, get the flair and the comment, and vault two opens. Harder." |
| 0:46–0:54 | Leaderboard: deepest vault today, top safecrackers, streak 🔥. | "Streaks and a leaderboard: how deep did we get today?" |
| 0:54–0:58 | Title card, app icon, `r/crackthevault_dev`. | "Crack the Vault. Together." |

Notes: no board game name anywhere in captions or voice-over. Do not show any unreleased secret code of an active vault. Check the final length is under 60 s before upload. Uploaded: https://youtu.be/gKDegcfmW3E

## Demo post checklist

- [ ] The post is made by the app (menu **Create today's vault** on r/crackthevault_dev, or the 00:00 UTC cron), not by hand.
- [ ] The post is public and visible to logged-out judges, and its link is in this file.
- [ ] Vault #1 is not cracked yet when judges arrive, or a fresh vault is open. A second account has unused tries (3 per UTC day).
- [ ] Both accounts are at least 3 days old.
- [ ] The splash loads in the feed and **Crack it** opens the game.
- [ ] The clue board shows several real clues from at least 2 accounts, so the demo is not empty.
- [ ] Realtime works in two tabs (a clue sent in one appears in the other without reload).
- [ ] The crack path was tested once on a throwaway vault: flair "Safecracker of the Day 🔓" and the crack comment both appear.
- [ ] The leaderboard opens without error.
- [ ] App page, subreddit, demo post, video and repo links are filled in above.
- [ ] `grep -i` for any board game brand name in this file, the video captions and the post text returns nothing.
- [ ] Submit on 6 Dec, a day before the deadline if possible. Hard deadline: 8 Dec 18:00 PST (9 Dec 09:00 WIB).
