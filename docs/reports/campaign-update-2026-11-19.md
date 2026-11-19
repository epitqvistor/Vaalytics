# Campaign data update — 2026-11-19 (dry run)

Sources re-downloaded into a fresh cache (`.\node_modules\.cache\poe1-campaign-update-2026-11-19T03-28-44`).

## Source versions

- repoe: 3.30.0.2.2 → 3.30.0.2.2 (same)
- exile-leveling: d6951db0ca94 → d6951db0ca94 (same)
- route: d6951db0ca94 → d6951db0ca94 (same)

## Areas (game files)

No changes.

## Levelling route (exile-leveling)

Steps: 540 (0 added, 0 removed, 0 changed).


## Quests

No changes.

## Book rewards — MANUAL REVIEW

No book changes: the passive point and respec quests are the same as in the verified reward database.

## Validators and tests

Tests  82 passed | 4 skipped (86)

## Undo

Dry run: the previous data was restored automatically.

```
node scripts/campaign-update.mjs --restore "D:\Vaalytics\node_modules\.cache\campaign-update-backup-2026-11-19T03-28-44"
```
