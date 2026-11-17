# UI preview (local only)

Mock data per `docs/client-contract.md`; not part of `npm run build` (Vite builds only
`src/client/*.html`).

```sh
npm run preview:ui   # http://localhost:5199/game.html?s=board
```

Scenarios (`?s=`): `board` (8 clues), `drill` (1 dial open), `cracked` (crack event after ~1 s; `&code=322` cracks
the first vault whose spec fits that code, `&me=1` makes it your crack),
`limit` (no tries left), `empty` (vault #1, no clues), `live` (a clue every 2.5 s), `loggedout`,
`stale` (codes left "≤ X", exact after ~2 s), `maxdials` (vault #9: 6 dials 0–9, the widest
vault — check it at 320 px), `drillsoon` (next dial opens 20 s after load: the drill chip
pulses, then the dial pops with a clunk). Splash: `/splash.html?s=…`.

Sound: the 🔊/🔇 header button toggles the synthesised SFX (`localStorage`
`crackthevault:muted`); audio starts after the first tap or key press.

Leaderboard sheet (🏆 chip, `?lb=`): `full` (top 10, today's cracks, you 14th), `top` (you 8th, row highlighted), `empty` (nothing
cracked yet; default for `s=empty`), `error` (fetch fails → retry). Example:
`/game.html?s=board&lb=error`.
