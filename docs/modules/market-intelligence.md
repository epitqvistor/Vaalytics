# Market Intelligence

Trends, movers, liquidity and price alerts across every market category, from
data Vaalytics already caches.

| | |
|---|---|
| Registry id | `market-intelligence` · group `economy` · PoE 1 ready · PoE 2 ready |
| UI | `src/shared/market-intel/MarketIntelligenceView.tsx`; entries `src/games/<id>/market-intelligence/index.tsx` |
| Logic | `analytics.ts` (category stats, movers, liquidity), `alerts.ts` (rules + evaluation) — tested in `analytics.test.ts` |
| Data | Market engine snapshots of every catalog category (`useMarketOverviews`), display currency rates; `DataKind` market (+ user for alert rules) |
| Patch rules | none (league-aware through the selected league) |

## Behaviour

- **Overview** — one row per category: items, liquidity, liquidity-weighted median 7-day
  change, risers/fallers (±0.5 % counts as flat), most liquid item, age of the data.
  Click a row to see its movers. Categories still being fetched show skeletons; failed ones say so.
- **Movers** — biggest 7-day changes across all loaded categories or one category. Filters:
  direction (largest / risers / fallers), minimum value (base unit), "more liquid half of each
  category only" (on by default, hides thin items whose % change means little). Top 60.
- **Liquidity** — the 50 most liquid items of a category and their share of the category's total.
- **Alerts** — "item at or above / at or below X" in the current "Prices in" currency.
  Checked whenever market data loads or refreshes while Vaalytics is open; triggered alerts are
  listed first and counted on the tab. Stored per game (`market.alerts`, max 100).
- Star (favourite) and + (alert) on every item row.

## Calculations

- Liquidity = poe.ninja traded value (exchange categories, base unit) or listings (item
  categories). The two are different measures and are never ranked together.
- Median 7d = weighted median of item `change7d`, weights = the category's liquidity measure
  (items without liquidity get a negligible weight). Robust against thin items with +5000 %.
- 7-day change comes from poe.ninja; early in a league it compares against launch prices,
  so very large changes are expected.

## Data integrity

- No new sources and no extra requests: the module reads the same cache-first snapshots as the
  Currency Tracker. Opening it asks the engine for every category once (one request per
  category per poe.ninja `max-age`, spaced 1.5 s); viewed categories are then kept fresh in the
  background for 2 hours (engine rule).
- Every view shows the data's kind, source and age (`ProvenanceTag`, "oldest update …"). A
  snapshot without a fetch time is treated as loading, never as "0 items".
- Alert values are converted with the current rate; without a rate the alert says so.

## Not yet

- Windows notifications for triggered alerts (alerts are in-app only).
- Long-range trends from the local hourly history (only poe.ninja's 7-day series is used).
- Alerts on items that aren't in a loaded category.
