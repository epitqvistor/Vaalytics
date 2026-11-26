# Mercenary Intelligence — completion report

Date 2026-11-26 · Vaalytics 0.24.1 (uncommitted) · PoE 1 3.30.0, league Covens · catalog
3.30.0-r1 · rules 3.30-r1 (review by 2026-12-10).

## What works

- **Input → parse.** Paste Ctrl+C text on the module page, or press the Price Checker hotkey on a
  warrant (Price Checker and overlay show the same check). Family, Normal/Infamous, mercenary
  level, skills, each skill's own supports and tiers are read; every field has a status; ambiguous
  and unknown fields can be corrected (choices limited to what the catalog says can roll), and a
  correction re-values immediately. **37 real warrants** (every warrant type with listings on
  Covens) parse with every field confirmed. Text stays in memory.
- **Catalog.** 37 families, 65 variants/warrant types, 272 skills, 151 rollable support identities,
  539 official stat ids, houses, attributes, weapons, pools, supports per skill with tiers, Trarthus
  and Vaal flags — generated from PoEDB and the official Trade data, registered in the Update Center
  (`poe1.mercenary-catalog`), patch-note lines about mercenaries flag it for regeneration.
- **Market.** Official Trade only, through the existing Trade client and rate limiter. Four
  comparison levels with the skill↔support binding kept (one bound group; `and`/`not` skill groups),
  query validation against the live stat list, 10-minute cache, de-duplication, one retry,
  source health, schema/size checks, snapshots and observations per league (no seller names).
- **Valuation.** Asking range, suggested list price, quick-sale target, comparable median and
  count, comparison level, freshness, confidence (High/Medium/Low/Insufficient), category, separate
  quality/demand/scarcity indicators, raw vs filtered statistics, excluded asks with reasons, every
  factor linked to its rule/observation/source; "Insufficient data" shows no price; a failed
  refresh shows the older snapshot marked stale.
- **Research tab.** Catalog browser, rules with evidence/confidence/review dates, controlled
  with/without comparisons that stage rule candidates (validate → promote / reject), configurable
  sample thresholds.
- **Checks run:** `npm run check:all` (typecheck, 498 Vitest tests incl. 86 for this module, 238
  Rust tests incl. 10 for this module), `cargo check`. Visual QA of the debug build over CDP
  (module page, overview grouping, valuation error path, Research tab).

## Calibration

Run with `calibration.live.test.ts` on 2026-11-26 19:46 UTC (Covens, securable, level ≥ 83,
lowest 20 asks per level, 1 div = 164.1c from poe.ninja). Asks, not sales.

| Warrant (real fixture) | Chosen level | Comparables | Estimate | Confidence | Category |
|---|---|---|---|---|---|
| Kineticist (KBoC + Return T3 + GMP T3, no Kinetic Bolt) | 2 (209 on Trade) | 20 | 10 div (10–11.5) | High | Worth price checking |
| Infamous Kineticist (same package + Greater Kinetic Blast) | 2 (22 on Trade) | 19 (+1 mirror excluded) | 100 div (55–175) | Medium | Premium |
| Combatant (Frost Blades package + Static Strike) | 2 (230) | 20 | 1 div | High | Worth price checking |
| Manyshot (VIS + Return + Mirror Arrow) | 2 (12) | 10 (+mirror excluded) | 20 div (1.5–53) | Low (wide spread) | High value |
| Chaplain of the Well (no Return/FC on Abyssal Spray) | 2 | 20 | 10c | High | Low value |
| Sniper (no Arrow Nova) | 2 (2,127) | 20 | 4c | High | Low value |
| Reanimator (generic family) | 2 (231) | 20 | 5c | High | Low value |

Controlled comparisons (same bound package, `and` vs `not` the skill):

| Family · package | Skill | With: listings / lowest-asks median | Without | Decision |
|---|---|---|---|---|
| Kineticist · KBoC + Return T3 + GMP T3 | Kinetic Bolt | 97 / 1 div | 209 / 10 div | rule **active** (was unverified) |
| Manyshot · VIS + Return T3 | Icicle Rain | 925 / 12c | 664 / 5 div | **unverified — conflicting** with the survey (175 div dearest asks); matched in searches, not a premium blocker |
| Combatant · FB + Return T3 | Spectral Helix | 455 / 6c | 1,320 / 10c | stays active (weak support at the cheap end) |

**Discrepancies found and fixed during calibration**

1. The complexity model under-counted by 3 (the level filter): every level-1 query was refused as
   "too complex". Fixed (`estimateComplexity(..., levelFilter)`); re-run estimates equal the server
   (49/47/45/43/7) and level 1 now runs. The UI also re-plans and retries once if the server still
   refuses.
2. A warrant with every premium condition but 20 comparables at ~10 div was labelled "Potential
   premium". Fixed: with enough level-1/2 evidence below 50 div the value bands apply.
3. Level 1 (exact) found 0–1 exact matches for the fixtures — real warrants rarely repeat exactly;
   the estimate correctly falls back to level 2 and says so.
4. Discrepancies with sources: PoEMercPricer maps Smite's Gilded Extra Targets to the wrong stat
   (CATALOG_AUDIT); its "Icicle Rain is not a brick" holds for dearest asks but not for the cheapest
   ones; the brief's "152 support identities" is 151 rollable / 154 on Trade.

## Limitations

- **Asks, not sales.** No verified sales source exists; every price is an estimate from asks.
- **One bound skill group** per anonymous search (GGG limit, verified). Other skills are matched by
  presence only; exact matches are verified per listing; Vaalytics never logs in or asks for
  POESESSID.
- **Lowest 20 asks per level**: the competitive end of the book, not the whole market.
- **Live searches need the Trade contact** (Settings → Price checker). The app's own live path was
  verified for the error case (no contact) in QA; the success path uses the same `TradeService` as
  the Price Checker and is covered by unit tests on a real fetch fixture, and the queries the module
  generates were run live by the calibration test (generic research User-Agent).
- `cargo test -- --ignored live_` needs `VAALYTICS_TRADE_CONTACT`; without it the live tests skip.
  The equivalent checks were done with the calibration test and manual searches (≈ 120 searches in
  total on 2026-11-26; one 429 during fixture collection, see MARKET_METHODOLOGY).
- Survey-derived rules (family tiers, packages) come from one third-party snapshot (day 5); Mysterious
  Diver and Warpriest of the Ruckus have no listings; Reddit could not be read; xddbsns data could
  not be read.
- The catalog is bundled: a new patch needs `scripts/poe1-mercenary-catalog.mjs` and an app release.
- Corrections that change the search plan reset the market check (a new check is needed); others
  re-value the existing listings.

## Remaining

- Repeat the controlled comparisons weekly and stage what holds; re-survey family tiers by
  2026-12-10.
- Optional: show the module's latest valuation in the overlay in a more compact layout.
