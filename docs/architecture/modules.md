# Modules

Every feature is a **module**: its own navigation entry, view, folder, state,
services, docs and tests. Navigation is generated from one registry, so adding a
module never touches the shell.

## Existing architecture (as of 0.6.x)

| Layer | Where | What it owns |
|---|---|---|
| Rust host | `src-tauri/src` | DB (SQLite, migrations), poe.ninja **Market engine** (`market/`: fetch, ETag/max-age cache, hourly history), official **Trade** client with GGG rate limiter (`trade/`), overlay + hotkey + clipboard (`overlay/`), PoE 2 session tracker (`session/`), Path of Building (`pob.rs`), crafting data (`crafting.rs`, RePoE), browser (`browser.rs`) |
| IPC | `src/core/ipc/commands.ts` | the only way the UI calls Rust |
| Core | `src/core/*` | game context, **module registry** (`modules/`), **versioned game data** (`game-data/`), **provenance** (`provenance/`), market hooks + league + display currency (`market/`), trade hooks, settings, diagnostics |
| Shared | `src/shared/*` | components, icons, charts, item parser core, item renderer, game-agnostic views (Dashboard, Currency, Price Checker, Trade, Builds, Tools) |
| Games | `src/games/poe1`, `src/games/poe2` | config, parser rules, entry points; game-specific modules (PoE 1 `crafting/`) |
| App | `src/app` | shell, title bar, atmosphere, `sections.ts` (only place that knows both games) |

## Reusable services — use these, don't re-fetch

| Need | Use | Notes |
|---|---|---|
| Prices of a category | `useMarketOverview(game, league, category)` / `useMarketOverviews` | cache-first; Rust refreshes only expired data (poe.ninja `max-age`, ETag) |
| Price history | `useMarketHistory` | local hourly history, per league |
| Selected league | `useLeague()` | per game, persisted |
| Show a price | `<Price>`, `<AltPrice>`, `useMoney()` | follow "Prices in" (display currency) |
| Freshness of market data | `<FreshnessBar snapshot>` | source + age + errors |
| Provenance of any value | `ProvenanceTag`, `describeProvenance`, `marketProvenance` | `src/core/provenance` |
| Live listings | `tradePriceCheck` / `useTradeContact` | official Trade API; never bypass the rate limiter |
| Parse a pasted item | `src/games/<id>/parser` | shared core `src/shared/item-parser` |
| Patch rules for the league | `usePatch(game)` / `patchFor` | `src/core/game-data` |
| Game data (mods, bases…) | Rust `crafting_data` (RePoE) | cached on disk, refreshed daily |

## Registry (`src/core/modules/registry.ts`)

```ts
{ id, label, icon, group: "overview" | "economy" | "endgame" | "character" | "tools" | null,
  summary,                       // one sentence, shown as the page description
  availability: { poe1?: "ready" | "planned", poe2?: … },   // absent = not offered
  plan?: { scope: string[], data: string[] } }              // required when planned
```

- **ready** → the view in `src/app/sections.ts` (`READY`) is shown.
- **planned** → `PlannedModuleView`: what it will do, which data it will use, and
  the patch rules for the selected league. No sample numbers. Shown in navigation
  (marked "Soon") only while **Settings → General → Show planned modules** is on.
- Tests (`registry.test.ts`) fail if a ready module has no view or a planned one has no plan.

Current groups:

| Group | PoE 1 | PoE 2 |
|---|---|---|
| Overview | Dashboard | Dashboard |
| Economy | Price Checker, Currency Tracker, Trade, Market Intelligence | Price Checker, Currency Tracker, Trade, Market Intelligence |
| Endgame | Map Lab, Farming Lab, Loot Intelligence, *Atlas Planner, Thread Planner, Fate Planner* | — |
| Character | Location Atlas, Builds, Path of Building & Tools | Campaign Intelligence, Builds, Path of Building & Tools |
| Tools | Crafting, REGEX, Browser | *Crafting*, Session Intelligence, Loot Journal, Browser |

*Italic* = planned.

## Adding a module (checklist)

1. **Registry**: add the id to `ModuleId` and an entry in `MODULES` (start as `planned` with a plan).
2. **Folder**: game-specific → `src/games/poe1/<module>/`; shared by both games →
   `src/shared/views/<Module>View.tsx` + logic in `src/core/<area>` or `src/shared/<area>`.
   Inside: `index.tsx` (view, default export), `types.ts`, services/hooks, pure logic in `.ts` files.
3. **Data**: only through the services above. New external sources go through Rust (caching,
   rate limits, User-Agent) and an IPC wrapper in `commands.ts`.
4. **Patch rules**: branch on `usePatch(game).definition?.mechanics` — never on hard-coded league names.
5. **Provenance**: every number shows its kind (Live / History / Estimate / Your data / Game data),
   source and time (`ProvenanceTag`, `FreshnessBar`).
6. **States**: loading (`EmptyState loading` / `Skeleton`), error (`EmptyState icon="error"`), empty.
7. **Docs**: `docs/modules/<module>.md` from [the template](../modules/_template.md); link it in `docs/modules/README.md`.
8. **Tests**: pure calculations and parsing in `*.test.ts` next to the code.
9. **Ready**: add the view to `READY` in `src/app/sections.ts`, set `availability` to `ready`.

## Data integrity

Distinguish five kinds of data (`DataKind`): **market** (live, as fetched), **historical**,
**estimate** (calculated by Vaalytics — never presented as a confirmed result), **user**
(entered/recorded by the user), **game-data** (extracted from game files / versioned
definitions). Never invent prices, listings or drop rates; when a source is unavailable show
an error or stale state. Historical league data is never mixed with the current league
(league is part of every market query and history row).
