---
description: Check the PoE 1 campaign data (Location Atlas + Act Tracker) against its sources, diff, validate, test and report.
---

Update the Path of Exile 1 campaign data from its sources and report what changed. Data rules from CLAUDE.md
apply: no invented data, and nothing verified is overwritten on the word of a single uncertain source.

1. Run `node scripts/campaign-update.mjs --dry-run` first (report only; the old data is restored).
2. Read the report in `docs/reports/campaign-update-<date>.md` and summarise it for the user: source versions, area
   changes (game files), route step changes, quest changes, and above all any **book reward changes** (passive /
   respec points).
3. If the user wants to apply the update, run `node scripts/campaign-update.mjs` (keeps the new data; the report
   names a backup and the `--restore` command to undo).
4. Never edit `src/games/poe1/act-tracker/data/rewards.ts` automatically. Book changes need a second source or the
   game's own `/passives` output; ask the user.
5. After applying: `npm run check:all`, `cargo check`, check the Act Tracker and Location Atlas pages in the app, and
   update `docs/modules/act-tracker.md` / `docs/modules/location-atlas.md` (patch, counts, sources).
