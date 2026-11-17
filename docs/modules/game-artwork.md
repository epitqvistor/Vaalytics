# Game artwork

Location: `src/assets/games/` (manifest: `index.ts`).

## Current artwork
Both selection tiles use **original Vaalytics illustrations** (SVG, ~6 KB each, crisp at any size):

- `poe1-wraeclast.svg` — "Ember Coast": storm-lit cliff with a ruined spire over a dark sea (ember/rust palette).
- `poe2-vaal.svg` — "Eclipse Over the Stepped Temple": moonlit stepped pyramid under an eclipse, jungle mist (teal palette with an orange corona).

They evoke each game's mood without copying Grinding Gear Games artwork, logos or trade dress. The UI credits them as original and states that Vaalytics is not affiliated with GGG.

## Why not official art (yet)
Researched 2026-11-16: Grinding Gear Games' terms reserve all rights in their materials and grant only a limited licence for using the website and game; no published fan-site/press-kit licence covering redistribution inside third-party software was found. Usage rights are therefore unclear, so official art is not bundled.

## Replacing with approved artwork
If you obtain artwork you are permitted to redistribute (e.g. written approval from GGG, or your own commissioned art):

1. Export ~1200×1600 px (portrait, 3:4), WebP quality ~80, target < 300 KB.
2. Save as `src/assets/games/poe1.webp` / `poe2.webp`.
3. In `index.ts`, import the new file, set `art`, adjust `focus` (CSS `object-position` of the focal point) and update `credit`.
4. Record the licence/permission source in this file.

Both the selection tile and the sidebar header pick up the change automatically.
