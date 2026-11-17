# UI preview (local only)

Mock data per `docs/client-contract.md`; not part of `npm run build` (Vite builds only
`src/client/*.html`).

```sh
npm run preview:ui   # http://localhost:5199/game.html?s=board
```

Scenarios (`?s=`): `board` (8 clues), `drill` (1 dial open), `cracked` (crack event after ~1 s),
`limit` (no tries left), `empty` (vault #1, no clues), `live` (a clue every 2.5 s), `loggedout`,
`stale` (codes left "≤ X", exact after ~2 s), `maxdials` (vault #9: 6 dials 0–9, the widest
vault — check it at 320 px). Splash: `/splash.html?s=…`.
