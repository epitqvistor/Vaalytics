# Update Center

Central synchronisation of **game data** for Path of Exile 1 and 2. One navigation entry (footer,
next to Settings, in both games). Application updates are a **separate** concern — see
[release.md → Application updates](../development/release.md#application-updates).
Decision record: [ADR 0005](../decisions/0005-update-center.md).

| | |
|---|---|
| Rust | `src-tauri/src/updates/` (`mod.rs` manager, `providers.rs`, `fetch.rs`, `diff.rs`, `validate.rs`, `registry.rs`, `store.rs`, `patchnotes.rs`, `tests.rs`) |
| DB | migration `0014_updates.sql` (schema v14) |
| IPC | `updates_*` in `commands.rs` / `src/core/ipc/commands.ts` |
| UI | `src/shared/views/update-center/*`, logic `src/core/updates/` (`logic.ts` + tests, `hooks.ts`) |
| Events | `updates:progress`, `updates:finished`, `updates:dataset-changed` |

## Pipeline

```
source → provider (fetch → parse → normalize to Entry{key,name,data})
       → change detection (diff vs installed)      — added / modified / removed / deprecated /
                                                       reclassified / description / metadata / structural
       → validation (structural, semantic, source) — passed / warnings / review / failed
       → staging (update_versions status=staged + update_changes pending)
       → apply (one transaction: installed → previous, staged/partial → installed)
       → version record + history event + prune (retention)
       → notify modules (Rust listeners + `updates:dataset-changed`)
```

- **Check for updates** stages only; installed data never changes.
- **Synchronize all** / scheduled runs apply what the policy allows: dataset policy `auto`, source
  official or established, validation `passed`/`warnings`, no change needing review. Structure
  changes, > 20 % removals, unverified sources and failed validation never auto-apply.
- **Apply selected** builds a *partial* version (installed + chosen changes), validates it again and
  installs it; remaining changes stay pending. Structure changes apply only with the whole update.
- **Ignore**: an identical change (same entry, same new value) found again starts ignored.
- **Rollback**: restores any kept version of the same format (validated again); the replaced version
  stays as `previous`; pending changes for that dataset are superseded. Nothing is deleted;
  retention (Settings, default 5) only drops the *content* of old versions, never their history.
- Failed validation is recorded (history + source health) and **not staged**.
- A provider may only return the dataset/game it was asked for (game isolation guard).
- A run is single-flight; a crash leaves it `running`, marked `interrupted` on next start. Data
  writes are transactional, so installed data is never half-applied.

## Sources (verified 2026-11-26)

| Provider | Reliability | What | How |
|---|---|---|---|
| `repoe-poe1` — RePoE fork | established | PoE 1 Divination Cards (`base_items.min.json`, ~3 MB, ETag + Last-Modified) | Update Center fetcher, conditional GET |
| `poe-ninja` | established | league index per game (and prices, via Market engine) | **Market engine** (`refresh_leagues`), no second client |
| `ggg-patch-notes` | official | PoE 1 `/forum/view-forum/patch-notes`, PoE 2 `/forum/view-forum/2212` | list page per check; first post of ≤ 3 new threads/game/check from the last 30 days; others on demand |
| `ggg-news` | official | `https://www.pathofexile.com/news/rss` (titles + links) | one request per check |

No authentication anywhere. robots.txt of pathofexile.com allows forum list/thread pages.
Fetcher rules: HTTPS only, host allowlist (`repoe-fork.github.io`, `www.pathofexile.com`), redirects
only within the allowlist (≤ 3), timeouts, size caps (48 MB RePoE, 4 MB forum pages, 2 MB RSS),
≥ 2 s between requests to pathofexile.com, 429 → `rate_limited` (Retry-After), one retry for
transient errors. Errors are classified (unavailable, timeout, auth, http, rate limited, too large,
structure changed, invalid data, blocked) and shown in Sources. A 200 with an unexpected shape is a
**structure** error, not success. Live checks: `cargo test -- --ignored live_repoe_cards_provider live_ggg`.

Not used (and why): `api.pathofexile.com/leagues` needs OAuth; `/api/` is disallowed in robots.txt
for crawlers (the Trade module uses the Trade API under its own rate limiter, unrelated);
poedb has no API; RePoE PoE 2 exists but no PoE 2 module consumes item data yet.

## Datasets and module registrations

Registry in `src-tauri/src/updates/registry.rs`. Affected modules are always derived from it.

| Dataset | Kind | Consumers |
|---|---|---|
| `poe1.divination-cards` | versioned, auto | Deck Intelligence |
| `poe1.leagues`, `poe2.leagues` | versioned, auto (league gone → `deprecated`, profile ended) | Dashboard, Currency, Market Intelligence, Price Checker, Trade |
| `poe1/poe2.market-prices` | managed (Market engine) | Currency, Market Intelligence, Dashboard, Price Checker, Deck Intelligence, Farming/Loot Intelligence, Ultimatum, Crafting, Loot Journal |
| `poe1.crafting-data` | managed (Crafting service, RePoE) | Crafting, REGEX |
| `poe1.ultimatum-modifiers` | bundled (poedb; RePoE doesn't export it) | Ultimatum Checker |
| `poe1.campaign`, `poe2.campaign` | bundled (hand-verified) | Location Atlas, Act Tracker / Campaign Intelligence |

- *Managed*: the owning engine keeps its cache; the Update Center shows state and can ask it to refresh
  (market: only expired categories of the selected league; crafting: conditional re-check). Prices are a
  time series per league — versioning/rollback would be meaningless and would duplicate the engine.
- *Bundled*: no verified structured source; only an app release changes them. Patch notes touching
  them are flagged **Needs developer implementation**.

### Registering a module
1. Add a `ModuleRegistration` to `MODULES` (required/optional dataset ids of the **same game**, whether
   automatic updates are acceptable). Tests fail on unknown datasets or cross-game dependencies.
2. Read data through the Update Center (`store::installed_entries` in Rust) — never fetch the source yourself.
3. React: `useDatasetChanged([id], reload)`; Rust: `UpdateService::on_dataset_changed`.
4. New source: implement `DatasetProvider` (fetch → normalized entries), add `ProviderMeta` and a
   `DatasetDef` (min entries, required fields, field→change-type rules), fixtures + an `#[ignore] live_` test.

### Deck Intelligence (integrated)
`decks_cards` reads the installed `poe1.divination-cards`. First use installs it (module-triggered sync);
if the source is unreachable on first use, Deck Intelligence's former `decks/cards.json` is imported
as version 1 (`origin: imported`). The card matcher is rebuilt on every dataset change. Session
valuations are untouched (they come from prices and are frozen on finish).

## League profiles
`league_profiles` per game from the installed league dataset: first/last seen, ended (detected when the
league leaves the index — the source has no official dates), patch rules via `patchFor`. Ended leagues are
never deleted; price history and sessions stay keyed by league name. Selecting a league sets the same
per-game setting as the league picker (active game via its `LeagueProvider`).

## Patch Notes Intelligence
Deterministic keyword rules (`patchnotes.rs`, `keyword rules v1`), no AI. Lines of the first post are
grouped by headings and classified (divination, currency, crafting, ultimatum, quests, campaign, rewards,
bosses, skills, uniques, items, mechanics, balance, bugfix, performance). Each category maps to datasets
and modules for that game: `data` (a data update covers it), `developer` (bundled data or app logic),
`info`. Confidence: specific terms → high; generic → needs review; article without a stated game →
unverified. Every entry links to the original thread. Nothing here modifies data or code.

## Scheduling
Settings key `updates.settings`: per group (game data, leagues, patch notes) `manual | startup | 6h | 12h |
24h | <n>h` (1–168), auto-apply, retention. Defaults: game data and leagues once per day (as Deck
Intelligence did before), patch notes manual. One sleeping task (no polling): first run 20 s after start,
then sleeps until the next due time or a settings change. Failed sources back off 15 min → 30 min → 1 h …
capped at the interval.

## Testing
- Rust: `cargo test updates` — diff, validation, fetch allowlist, patch-note parsing/classification,
  and end-to-end lifecycle on an in-memory DB with fixture providers (check vs sync, partial apply,
  rollback, failed validation, source errors, structure change, mass removal, ignore persistence,
  league profiles, retention, interrupted runs, disabled sources, Deck Intelligence first use and offline import).
- Live (`--ignored`): RePoE cards (+ 304 on ETag), both patch-notes forums + a thread, the RSS feed.
- Frontend: `src/core/updates/logic.test.ts` (freshness, module status, counts, labels, field diffs).

## Limitations
- Only one versioned game-data dataset (PoE 1 cards) plus leagues. Market prices and crafting data are
  managed by their engines; Ultimatum modifiers and campaign data are bundled.
- Patch-note classification is keyword-based; it can over- or under-match. It never acts on its own.
- League start/end dates are “first/last seen by Vaalytics”, not official dates.
- Forum dates have no time zone on the page; they are read as UTC.
- No application self-updater (see release.md).
