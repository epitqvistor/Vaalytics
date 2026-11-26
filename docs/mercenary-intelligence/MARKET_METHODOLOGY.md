# Market methodology (stages E and G)

## Source

Only the official Trade API (`pathofexile.com/api/trade`), league from `useLeague()`, through the
existing `TradeService` (contact User-Agent, shared rate limiter, `Retry-After`). poe.ninja is used
only for currency rates (Market engine). No POESESSID, no login, no other price source.

## What anonymous searches allow — measured 2026-11-26 (Covens)

| Query | Result |
|---|---|
| one `mercenary` group: skill + 2 supports | 200, complexity 40 |
| one `mercenary` group: skill + 5 supports (6 filters) | 200, complexity 46 |
| one `mercenary` group: 7 filters | 200, complexity 48 |
| **two `mercenary` groups** (3 filters in total) | **400** "Query is too complex. Please reduce the amount of filters used. Logging in will increase this limit." |
| bound group (6) + `and` group (2 skills) | 200, complexity 49 |
| bound group (6) + `and` group (5 skills) | **400** too complex (estimated 52) |
| bound group (3) + `and` (2 skills) + `not` (1 skill) | 200, complexity 45 |
| `and` group with a support id | accepted by Trade, but **unbound** (matches the support on any skill) — Vaalytics never sends it |

Complexity model fitted to every measurement: `4 + (3 if the level filter is set) + (30 + 2 × bound
filters) + Σ(2 + extra filters per and/not group)` — the +3 was found in calibration, after which
every estimate equalled the server's value (49, 47, 45, 43, 7); Vaalytics plans with a budget of 49 and trims (`not` first, then `and`, then
the weakest bound support), listing what it dropped. If the server still answers "too complex", the
UI re-plans that level with a smaller budget and retries once.

**Consequence:** a full warrant (several skills each with supports) can never be one anonymous
query. Vaalytics therefore binds the value-carrying skill's group, requires or excludes other
skills by presence, and verifies "exact" on each returned listing's full `mercenarySkills` data. It
never claims a full-warrant match from the query.

## Comparison levels

| Level | Query | Comparable set |
|---|---|---|
| 1 Exact warrant | value skill + all its supports (bound) + every other skill present | only listings whose full configuration (variant, every skill, every support and tier, level) equals the warrant |
| 2 Exact value package | value skill + package supports (family rule, at the warrant's tiers) + same partner / downside skills; downsides the warrant lacks are excluded (`not`) | all returned listings |
| 3 Similar configuration | value skill + its value supports only | all returned listings |
| 4 Family baseline | warrant type (normal / Infamous) only | all returned listings |

All levels: `status: securable` (instant buyout — firm, buyable asks; 586 vs 3 "online" Manyshot
listings in PoEMercPricer's test), item-level filter = mercenary level (Trade maps `ilvl` to it;
JSON shows `ilvl: 0`), `sort: price asc`, the lowest 20 asks fetched. Infamous and normal are
searched with their own warrant type (not pooled — unlike xddbsns, which pools them).

The estimate uses the most specific level with at least the "exploratory" number of kept asks.

## Filtering (every exclusion keeps its reason; raw vs filtered both shown)

1. No price on the listing.
2. Mirror asks — aspirational/placeholder (as in the PoEMercPricer survey).
3. No conversion rate for the currency.
4. Asks of 1,000 divine or more (placeholders such as 99,999,999 div).
5. Level 1 only: not the exact configuration.
6. High outliers: above Q3 + 3·IQR on log prices, only with ≥ 8 asks.

## Statistics and prices

- Stored per level: total on Trade, fetched, kept, raw and filtered min / p25 / median / p75 / max,
  conversion rates used (currency → chaos, poe.ninja, per snapshot).
- Asking range = p25–p75 of kept asks; suggested list price = median; quick-sale target =
  max(min, 0.85 × p25). Rounded to whole chaos below 1 div, 0.5 div below 20 div, whole divines
  above. All are **estimates from asks** — never presented as sales.
- Because the lowest 20 asks are fetched, statistics describe the competitive (cheapest) end of
  the book: the prices a new listing competes with. This is stated in the UI.

## Confidence

Sample class of the chosen level (configurable thresholds, default <5 insufficient, 5–7
exploratory, 8–14 limited, 15–29 moderate, ≥30 stronger) → Low / Medium / High, then:
level cap (1–2: High, 3: Medium, 4: Low); 15–29 asks need p75 ≤ 2.5 × p25 for High; a very wide
spread (p75 > 4 × p25) lowers one step; stale lowers one step, very stale caps at Low; any
unconfirmed field (family, variant, level, skill, support or tier) caps at Low. Fewer asks than the
exploratory threshold → "Insufficient data" and no price.

## Freshness

fresh < 15 min · recently updated < 2 h · stale < 24 h · very stale ≥ 24 h · unavailable (never
fetched). A failed refresh returns the last good snapshot marked stale with its own time and the
error — never as current. Searches are cached 10 minutes (per league + exact query); "Refresh"
bypasses the cache.

## Categories

Premium (all premium conditions of the family rule hold, no active downside, ≥ 8 level-1/2 asks
with median ≥ 50 div) · Potential premium — needs price check (conditions hold, evidence doesn't) ·
High value (median ≥ 15 div) · Worth price checking (≥ 1 div) · Common (≥ 0.2 div) · Low value ·
Unknown (insufficient data or no divine rate). Bands follow the PoEMercPricer tier bands (premium
≥ 50 div, high 15–50) and are applied to comparable medians, not to scores.

## Indicators (separate from price)

Combination quality (rule package present / incomplete / missing, known downside), demand (family
tier from a survey of asks — labelled "not sales"; unknown where no survey exists), scarcity
(listings matching the value package at level 2/3).

## Rate-limit incident (2026-11-26, research only)

While collecting fixtures with a research script (not the app), 30 searches inside 5 minutes
triggered a 429 and the IP rule's 1,800 s penalty. The app's limiter reads the same headers and
refuses long waits instead of queueing; the calibration test paces one search per 15 s and waits
when a window is nearly full.
