# Brand assets (Runware)

Offline tooling, not part of the app build. `sharp` lives in `tools/assets/node_modules`.

```sh
cd tools/assets && npm install
# generate (costs money; skips nothing — use --only to target items)
RUNWARE_API_KEY="$(secret get 'Runware — API key')" node generate.mjs --ref ../../assets-src/brand/ref-door.png --only icon
node process-brand.mjs        # assets-src/brand/*.png -> assets/, public/brand/
node contact-sheet.mjs ../../spike-evidence/m4/assets-contact.png ../../assets/icon.png ...
```

- Config/prompts: `brand.json`. Full-res sources + `manifest.json` (model, seed, cost): `assets-src/brand/` (PNGs git-ignored except `ref-door.png`, a crop of the CSS vault door used as style reference).
- Models: `bytedance:seedream@5.5` (icon, banner), `ideogram:4.5@0` (wordmark), `runware:112@5` BiRefNet (logo background removal).

| Output | Size | Use |
| --- | --- | --- |
| `assets/icon.png` | 1024×1024 | `devvit.json` `marketingAssets.icon` |
| `assets/subreddit/avatar.png` | 256×256 | r/crackthevault_dev community icon |
| `assets/subreddit/banner.jpg` | 1920×384 | r/crackthevault_dev banner (desktop + mobile) |
| `public/brand/logo.webp` | 640×270, alpha | optional in-game wordmark (served as `/brand/logo.webp`) |

## In-game integration notes (for the UI owner)

The CSS vault door, gold bars and confetti already carry the look; no raster art is needed for play. Keep the splash raster-free (inline feed view, < 10 KB budget).

Optional: `public/brand/logo.webp` (47.5 KB) as a header/wordmark in `game.html` only, e.g. above the board or in the cracked overlay:
`<img src="/brand/logo.webp" width="320" height="135" alt="Crack the Vault" loading="lazy" decoding="async">` (display at ≤ 320 px wide = 2x density). Do not reference it from `splash.html`/`splash.css`.
