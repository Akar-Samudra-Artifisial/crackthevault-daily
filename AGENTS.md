You are writing a Devvit web application that will be executed on Reddit.com.

## Tech Stack

- **Frontend**: plain DOM + CSS (no Phaser, no canvas engine), TypeScript, Vite
- **Backend**: Devvit serverless Node.js runtime, Hono REST routes, bundled to `dist/server/index.cjs` by `@devvit/start/vite`. Local tooling: Node >= 24 (`package.json` engines, `.nvmrc`).
- **Communication**: plain `fetch` to `/api/*` (no tRPC). Request/response types and runtime parsers live in `src/shared/api.ts`; validate untrusted JSON with those parsers instead of casting.

## Layout & Architecture

- `/src/server`: **Backend Code**. This runs in a secure, serverless environment.
  - `index.ts`: Main server entry point (Hono app). Public routes under `/api`, Devvit-called routes (menu, forms, triggers, scheduler) under `/internal`.
  - `routes/*.ts`: Hono routers; `core/*.ts`: Redis/Reddit logic.
  - Access `redis`, `reddit`, `realtime`, and `context` here via `@devvit/web/server`.
- `/src/client`: **Frontend Code**. This is executed inside of an iFrame on reddit.com
  - To add an entrypoint, create a HTML file and add to the mapping inside of `devvit.json`
  - Entrypoints:
    - `game.html`: The main game entry point (Expanded View): dials, clue board, guess form.
    - `splash.html`: The initial lightweight entry point (Inline View). This will be shown in the reddit.com feed. Please keep it fast and keep heavy dependencies inside of `game.html`
- `/src/shared`: **Shared Code**. Code to share between the client and server

## Frontend

### Rules

- Instead of `window.location` or `window.assign`, use `navigateTo` from `@devvit/web/client`

### Limitations

- `window.alert`: Use `showToast` or `showForm` from `@devvit/web/client`
- File downloads: Use clipboard API with `showToast` to confirm
- Geolocation, camera, microphone, and notifications web APIs: No alternatives
- Inline script tags inside of `html` files: Use a script tag and separate js/ts file

## Commands

- `npm run type-check`: Check typescript types
- `npm run lint`: Check the linter
- `npm run test:unit`: Run unit tests (`node --test`, files in `tests/`; they import `src/shared/*.ts` directly, so shared modules under test may only use `import type` for other modules)
- `npm run build`: Vite build of client + server

- `npm run sim`: Crowd simulation for difficulty tuning (`tools/sim/vault-sim.ts`, ~2 min)

## Game rules (must hold)

- One vault per subreddit per UTC day; vault #N+1 starts as soon as #N is cracked.
- The active secret lives only in Redis (`v:{sub}:{day}:secret:{round}`) and is never sent to a client; only codes of cracked rounds are public. The one exception is the drill: `revealDials` in `src/shared/drill.ts` opens one dial per 6 hours of a round (max dials − 1), derived from `VaultMeta.roundStartMs` + clock, never written step by step.
- 3 guesses per user per UTC day across all rounds, moderators included (no bypass). Enforced inside the WATCH/MULTI transaction in `src/server/core/vault.ts`.
- Vault spec (dials, digit range, no-repeat) comes from `specFor(day, round)` in `src/shared/vault.ts` (vault #1 is rung 0 every day; the weekday picks the rung of vault #2 in `LEVEL_LADDER`, each later vault that day climbs one rung); validate every guess with `parseGuess` on the server.
- Feedback is counts only (🟢 right dial, 🟡 other dial), never per dial. Never name the trademarked code-breaking board game anywhere (code, UI, docs); say "code-breaking clues".

## Code Style

- Prefer type aliases over interfaces when writing typescript
- Prefer named exports over default exports
- Never cast typescript types

## Global Rules

- You may find code that references blocks or `@devvit/public-api` while building a feature. Do NOT use this code as this project is configured to use Devvit web only.
- Whenever you add an endpoint for a new menu item action, ensure that you've added the corresponding mapping to `devvit.json` so that it is properly registered

Docs: https://developers.reddit.com/docs/llms.txt.
