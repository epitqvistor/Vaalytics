# Mercenary Intelligence — architecture audit (stage A)

Date: 2026-11-26 · Vaalytics 0.24.1 · PoE 1 3.30.0 (Covens). Done before any module code; it
decides what is reused and what the module adds.

## What exists and how it is reused

| Area | Existing implementation | Decision for Mercenary Intelligence |
|---|---|---|
| Official Trade client | `src-tauri/src/trade/mod.rs` `TradeService`: contact-based User-Agent (no contact → no live search), `RateLimiter` (`trade/ratelimit.rs`) fed by `X-Rate-Limit-*` headers, 429 → `Retry-After` block, long waits reported instead of queued, Cloudflare/HTML error detection, 20 s timeout, 64 KB query cap, `/data/stats` cached 24 h on disk | **Reused.** Added one narrow method, `search_raw`, that runs the same `send` (limiter, UA, error mapping) but returns raw fetch results, because the normalized `Listing` drops `item.mercenarySkills`. Also `has_contact()` for source health. No second HTTP client, limiter or cache of the Trade stat list. |
| Trade stat list | `TradeService::stats()` (24 h disk cache, stale copy on failure) | **Reused** to validate every mercenary query against the live official ids. |
| Rate limits | per-policy limiter (`trade-search-request-limit`, `trade-fetch-request-limit`) | Shared with the Price Checker: a warrant check and a price check never exceed the limits together. Measured live: search `5:10:60, 15:60:300, 30:300:1800, 600:21600:3600`; fetch `12:4:10, 16:12:300, 50:300:300, 1000:21600:1800`. |
| Currency conversion | `TradeService::rates()` from the Market engine's poe.ninja currency snapshot (per league) | **Reused** (rates come back with each raw search and are stored with the snapshot). |
| MarketEngine | `src-tauri/src/market` (poe.ninja, ETag/max-age, hourly history) | Not a source of warrant prices — poe.ninja has no warrant category (verified: none in the 3.30 category list). Only its currency rates are used. |
| Clipboard | `src-tauri/src/overlay` reads the clipboard only right after the price-check hotkey (CLAUDE.md rule 4) | **Reused via the Price Checker "special view" hook** (`SpecialItemView`, as Ultimatum does): a copied warrant opens the Mercenary check in the Price Checker/overlay. The module page itself never reads the clipboard; the user pastes with Ctrl+V. |
| Item parser | `src/shared/item-parser` + `src/games/poe1/parser` (generic item text) | The generic parser gives `baseType = "Mercenary Warrant"` and keeps `raw`; skills/supports need a dedicated parser (`src/games/poe1/mercenary/parse.ts`) because supports must stay bound to their skill section. |
| Patch / league | `usePatch(game)` (`src/core/game-data/poe1.ts` maps Covens → 3.30), `useLeague()` | The page reads `usePatch("poe1")` and warns if the league's patch differs from the catalog's game version. No league name is hard-coded in logic. |
| DB | SQLite, append-only migrations in `src-tauri/migrations` + `MIGRATIONS` | New `0016_mercenary.sql`: snapshots, observations, valuations, rule candidates — all with `game CHECK (game = 'poe1')` and `league` in every key. |
| Versioned game data | Update Center (`src-tauri/src/updates/registry.rs`) | Catalog registered as dataset `poe1.mercenary-catalog` (Bundled: no structured upstream feed exists; PoEDB pages are HTML) and module `mercenary-intelligence` registered with its dependencies. |
| Design system | `@/shared/components` (Panel, Badge, Table/Th/Tr/Td, Select, SegmentedControl, EmptyState, ProvenanceTag), `<Icon>`, `@/shared/design/motion`, tokens | Used throughout. `FreshnessBar` is typed to a poe.ninja `MarketSnapshot`, so the module renders an equivalent freshness row (source, age, cache, error, league, catalog version) from its own snapshot type. |
| IPC | `src/core/ipc/commands.ts` ↔ `src-tauri/src/commands.rs` + `generate_handler!` | Nine `merc_*` commands added together in all three places. |
| Tests | Vitest (`src/**/*.test.ts`), cargo tests, `live_*` ignored network tests | Parser/catalog/rules/valuation tests in Vitest; query validation, listing schema, persistence and an ignored `live_mercenary_search_and_limits` test in Rust. |

## Boundaries

- Frontend (pure TS, testable): catalog index, parser, rules, search planning, matching, statistics,
  valuation, explanations. It builds queries; it never fetches.
- Rust: executes searches through `TradeService`, validates queries and listing shapes, caches
  (10 min), de-duplicates (one mercenary search at a time, then cache), retries once on a network
  error, tracks source health, persists snapshots per league. Never reads seller account names.
- No new external software, no clipboard polling, no credentials (no POESESSID), no remote IPC.

## Risks found during the audit

- Shared files touched: `trade/mod.rs` (two additive methods), `lib.rs`, `commands.rs`, `db.rs`,
  `updates/registry.rs`, `commands.ts`, `registry.ts`, `sections.ts`, `gameModules.ts`,
  `price-checker/index.tsx`, two docs index tables. All additive.
- `trade.contact` must be configured for live searches (same as the Price Checker).
- The Price Checker and Mercenary Intelligence share the IP rate limit with any other Trade tool the
  user runs; the limiter only knows Vaalytics' own requests (the server state headers correct it).
