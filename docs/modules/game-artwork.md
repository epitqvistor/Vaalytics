# Game artwork

Location: `src/assets/games/` (manifest: `index.ts`).

## Current artwork
Both selection tiles (and the sidebar game switcher) use **original raster artwork supplied by the project owner** (2026-11-26, cropped from their game-selection mockup; WebP, 584×655):

- `poe1.webp` — ember-lit gothic citadel with red banners, a cloaked figure before a burning gate.
- `poe2.webp` — dark cathedral spire inside a broken ring, a pillar of light, a cloaked figure on a stepped plinth.

They are not Grinding Gear Games artwork, logos or trade dress. The UI states that Vaalytics is not affiliated with GGG.

The crops are only 584 px wide, so they look slightly soft on high-DPI screens. For sharper tiles, export the source images at ~1200×1600 and replace the files (same names).

Earlier versions (≤ 0.20.0) used hand-drawn SVG illustrations (`poe1-wraeclast.svg`, `poe2-vaal.svg`); they are in git history.

## Why not official art (yet)
Researched 2026-11-16: Grinding Gear Games' terms reserve all rights in their materials and grant only a limited licence for using the website and game; no published fan-site/press-kit licence covering redistribution inside third-party software was found. Usage rights are therefore unclear, so official art is not bundled.

## Replacing with approved artwork
If you obtain artwork you are permitted to redistribute (e.g. written approval from GGG, or your own commissioned art):

1. Export ~1200×1600 px (portrait, 3:4), WebP quality ~80, target < 300 KB.
2. Save as `src/assets/games/poe1.webp` / `poe2.webp`.
3. In `index.ts`, import the new file, set `art`, adjust `focus` (CSS `object-position` of the focal point) and update `credit`.
4. Record the licence/permission source in this file.

Both the selection tile and the sidebar header pick up the change automatically.
