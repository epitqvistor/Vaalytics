# Market data engine

Location: `src-tauri/src/market/` (Rust), `src/core/market/` (React hooks), `src/shared/views/{CurrencyView,DashboardView,market-ui}.tsx`.

## Source: poe.ninja
Verified live on 2026-11-16 (see `docs/research/price-check-and-data-sources.md`). The endpoints are not officially documented; they are the ones the poe.ninja website itself uses.

| Purpose | Endpoint | Cache-Control |
|---|---|---|
| Leagues | `/{poe1\|poe2}/api/data/index-state` | `max-age=300` |
| Currency-like categories | `/{game}/api/economy/exchange/current/overview?league=&type=` | `max-age=1800` |
| Uniques, maps, invitations (PoE 1 only) | `/poe1/api/economy/stash/current/item/overview?league=&type=` | `max-age=1800` |

Item icons come from the official CDN `https://web.poecdn.com` (the only image host allowed by the CSP and by the normalizer).

## Pipeline
```
UI hook ──invoke──▶ engine.snapshot()  ──▶ SQLite (instant)            ──▶ UI
                         │ expired?
                         └─▶ spawn refresh ──▶ http (serialized, spaced, ETag)
                                               ├─ 304 → bump expiry
                                               └─ 200 → normalize → replace items + hourly history
                                             ──▶ emit `market:updated` ──▶ UI re-reads
```

- **Cache-first.** Every read returns stored data immediately, with `fetchedAt`, `expiresAt`, `lastError` so the UI can show freshness and errors honestly.
- **Respecting the source.** Refreshes happen only when the stored copy has expired according to the source's own `Cache-Control: max-age` (clamped to 5 min–6 h). Requests are serialized with ≥1.5 s spacing, use `If-None-Match`, and carry a descriptive User-Agent. Manual refresh is disabled until data expires.
- **Retries.** Up to 3 attempts for network errors, HTTP 5xx and 429 (honouring `Retry-After`, capped at 120 s). After a failure the resource is not retried automatically for 5 minutes (or `Retry-After`, if longer). Cached data stays visible with a warning.
- **Interest-driven background sync.** A 60 s tick refreshes only resources viewed in the last 2 hours *and* expired. Nothing is fetched for categories nobody looks at.
- **De-duplication.** One in-flight refresh per (game, league, category).

## Normalization
Values are stored in the game's base unit — **PoE 1: chaos**, **PoE 2: exalted** — plus divine. Conversion uses only the rates returned in the same response (PoE 2 exchange data is divine-denominated; `rates.exalted` converts it). Lines without a value or metadata are skipped and counted, never guessed. 7-day change is reported only when the source has ≥2 data points. `NORMALIZER_VERSION` invalidates stored ETags when normalization changes.

Low-confidence entries (fewer than 5 listings) are hidden by default in the tracker and marked when shown.

## Storage (migration 0002)
| Table | Key | Notes |
|---|---|---|
| `market_leagues` | (game, name) | league list per game |
| `market_fetches` | (game, league, category) | fetchedAt, expiresAt, etag, lastError |
| `market_items` | (game, league, category, item_id) | latest normalized snapshot |
| `price_history` | (game, league, category, item_id, hour) | one point per item per hour; pruned after 120 days |

## IPC
`market_categories`, `market_leagues`, `market_overview`, `market_refresh`, `market_history`, `market_stats`; event `market:updated {game, league, category, ok}`.

## Frontend
- `LeagueProvider` (per game shell): league list + persisted selection (`market.league`, per game). Never requests data before the stored choice is loaded.
- `useMarketOverview`, `useMarketOverviews`, `useMarketHistory`, `useFavorites` (`market.favorites`, per game).
- `VirtualRows` renders only visible rows (881-row categories render ~20 DOM rows).

## Tests
- Unit: catalog, normalizers (fixtures mirroring real payloads), store (isolation, history bucketing, fetch meta), max-age parsing.
- Live (opt-in, network): `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_` — normalizes every catalog category for both games and verifies the 304 path.

## Known limitations
- poe.ninja endpoints are undocumented and may change; the live test is the canary.
- PoE 2 has no unique-item endpoint on poe.ninja at the time of writing, so PoE 2 shows exchange categories only.
- Scarabs did not return data for the current PoE 1 league via the exchange endpoint and are not listed.
- Locally recorded history only accumulates while Vaalytics is open and the category is viewed.

## Display currency ("Prices in")

`src/core/market/DisplayCurrency.tsx` — per-game setting `market.displayUnit` (currency id,
default: the base unit). Values stay stored in the base unit; the UI divides by the chosen
currency's current poe.ninja rate (currency snapshot). Without a rate (not loaded / delisted)
values are shown in the base unit — never estimated. The picker (`DisplayCurrencySelect`) sits in
the headers of Dashboard, Currency Tracker, Price Checker and Crafting; the choice applies
everywhere, including the price-check overlay.
- `Price` converts base amounts automatically; `AltPrice` shows the second line (premium unit in
  base mode, base value otherwise); `useMoney()` / crafting `useChaos()` format plain numbers.
- Not converted: listing prices (shown in the seller's currency, with a converted "≈" line),
  charts of an item's price history (a current rate would distort history) and listing counts.

## Base type (normalizer v4, migration 0003)

Stash endpoints (uniques) keep poe.ninja `baseType` in `market_items.base_type` / `MarketItemRow.baseType`
(null for exchange categories). Used by Loot Intelligence to group uniques by base.
