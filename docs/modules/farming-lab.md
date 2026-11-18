# Farming Lab (PoE 1)

Record your farming sessions and compare strategies by your own results.

| | |
|---|---|
| Registry id | `farming-lab` · group `endgame` · PoE 1 ready · PoE 2 not offered |
| UI | `src/games/poe1/farming-lab/index.tsx` |
| Logic | `farming.ts` (totals, strategy comparison, validation) — tested in `farming.test.ts` |
| Rust | `src-tauri/src/farming.rs` (validate + store), migration `0004_farming.sql`; commands `farming_sessions`, `farming_save_session`, `farming_delete_session` |
| Data | `DataKind` user (sessions); loot/cost prices picked from Market engine snapshots (poe.ninja) |

## Behaviour

- **Current session**: strategy name (suggestions from earlier sessions), maps run (+/−), a timer
  (start / pause / resume — keeps running across sections and restarts) or a typed duration in
  minutes, loot and cost lines, notes. The draft is saved per game (`farming.draft`).
- **Lines**: search the cached market (stackables, maps, uniques) and pick an item — its current
  poe.ninja price is stored with the line (with the data's time), so a saved session never changes
  when prices move. Or type a name and a value ("manual"). Quantities are editable.
- **Save**: needs a strategy, a duration and at least one line. Sessions are stored per game and league.
- **Strategies**: sessions grouped by name (case/space-insensitive). Profit/hour = total profit ÷
  total time (pooled), per map likewise; the tooltip shows the range across sessions; strategies
  with fewer than 3 sessions are marked "few".
- **Sessions**: history with profit and profit/hour; delete asks for confirmation.

## Data integrity

- Everything shown is the user's own record. No drop rates, no expected values, no invented loot.
- Market-priced lines say so ("poe.ninja" badge, tooltip with the price time); manual lines are marked "manual".
- Values are stored in chaos (PoE 1 base unit) and displayed in the "Prices in" currency.
- Host validation: strategy 1–80 chars, duration ≤ 7 days, maps ≥ 0, data ≤ 64 KB, ≤ 2000 sessions per league.

## Not yet

- Editing a saved session (delete and re-record instead).
- Importing loot from a stash tab or the clipboard; per-map logging.
- Export (CSV).
