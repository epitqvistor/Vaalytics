# Mercenary Intelligence (PoE 1)

Value a Mercenary Warrant for sale: family, skills and bound supports read from Ctrl+C, comparable
listings from the official Trade site, an asking range with its confidence and the evidence behind
it. It answers one question — "is this warrant worth selling, what makes it valuable, what should I
ask, how strong is the evidence?" — and is not a build advisor (it never says "good/bad for your
build").

| | |
|---|---|
| Registry id | `mercenary-intelligence` · group `economy` · PoE 1 `ready` · PoE 2 not offered |
| UI | `src/games/poe1/mercenary/` (`index.tsx`, `components.tsx`, `ResearchAdmin.tsx`, `MercenaryCheck.tsx` for the Price Checker / overlay) |
| Logic | `catalog.ts`, `parse.ts`, `rules.ts`, `query.ts`, `valuation.ts` (pure, tested) |
| Rust | `src-tauri/src/mercenary/` (`mod.rs` service + query validation, `model.rs` listing schema, `store.rs` SQLite) · `TradeService::search_raw` |
| Data | official Trade (market), poe.ninja currency rates (market), catalog (game-data, bundled dataset `poe1.mercenary-catalog`), your checks and promoted rules (user), survey evidence (historical, third-party asks) |
| Patch rules | `usePatch("poe1")`: warns when the league's patch differs from the catalog's game version |
| Research | [../mercenary-intelligence/](../mercenary-intelligence/) — audit, research report, sources, methodology, catalog audit, scoring evidence, completion report · ADR [0006](../decisions/0006-mercenary-intelligence.md) |

## Behaviour

- **Input**: paste the Ctrl+C text (the page never reads the clipboard), or press the Price
  Checker hotkey on a warrant in game — the Price Checker / overlay then shows the same check.
- **Overview**: family, Normal/Infamous, level, house, attributes, weapons; each skill with its own
  supports and tiers nested under it. Every field has a status (confirmed / inferred / ambiguous /
  unknown). Ambiguous or unknown fields get a correction control limited to what the catalog says
  can roll there; a correction re-resolves every binding and re-values the last market data at once.
- **Market check**: up to four searches (levels 1–4), one at a time through the shared limiter;
  progress per level; errors shown verbatim; "Refresh" bypasses the 10-minute cache.
- **Valuation**: category, confidence, comparison level, freshness, suggested list price, asking
  range, quick-sale target, comparable median and count, rate used; reasons for confidence and
  category. "Insufficient data" shows no price.
- **Value breakdown**: combination quality / demand / scarcity, and every factor with its rule,
  observation or source (survey, observation, patch note, opinion — opinions labelled).
- **Comparable listings**: per level, kept and excluded asks with reasons, raw vs filtered medians,
  what the query contained and what was dropped, a link to the same search on Trade.
- **Research evidence** (expandable) and **Market history** (your earlier checks of the same
  warrant in this league).
- **Research tab**: catalog (families, houses, variants, pools, supports per skill with tiers and
  stat ids), rules with status/confidence/evidence/review date, controlled with/without
  comparisons, rule candidates (stage → validate → promote / reject), sample thresholds.

## Calculations

See [MARKET_METHODOLOGY.md](../mercenary-intelligence/MARKET_METHODOLOGY.md). Prices come only from
comparable asks; rules never produce a price.

## Data integrity

- Tables (migration 0016): `mercenary_snapshots`, `mercenary_observations`, `mercenary_valuations`,
  `mercenary_rule_candidates` — each with `game CHECK (game = 'poe1')`, `league`, platform, game
  version and catalog version. Seller account names are never read or stored. The pasted text is
  kept in memory only.
- Settings: `mercenary.thresholds` (per game, PoE 1).
- IPC: `merc_search`, `merc_health`, `merc_snapshots`, `merc_save_valuation`, `merc_valuations`,
  `merc_delete_valuation`, `merc_stage_rule`, `merc_review_rule`, `merc_rule_candidates`.
- Live searches need the Trade contact (Settings → Price checker), as the Price Checker does.

## Tests

- `parse.test.ts`: catalog counts and stat coverage, shared-text stats, Normal vs Infamous, 29 real
  warrants (one per available warrant type) fully confirmed, Area Level / Item Tier never read as
  level, wrapped names, tier forms, unrollable supports, wrong tiers, unknowns, out-of-pool skills,
  missing Build line, corrections, fingerprints (order-independent, binding-sensitive).
- `valuation.test.ts`: one regression test per family rule set (rollable skills, attainable gates,
  real evidence), contradicted rules never applied, thresholds, search plans (binding, downside
  match vs exclusion, Infamous type, complexity budget on every real warrant, measured complexity),
  matching (exact, moved support, Infamous), exclusions with reasons, outliers, no listings, one
  listing, thin market, premium, downside blocks premium, common, stale and failed refresh,
  rate-limited, currency/no rate, incomplete responses, uncertain bindings, level choice, rounding.
- Rust `mercenary::tests`: query validation (unknown stats, second bound group, unbound supports,
  other shapes), real listing fixture parsing without accounts, malformed listings, per-league
  snapshots and stale fallback, candidate review safety, valuation storage; ignored
  `live_mercenary_search_and_limits`.
- `calibration.live.test.ts` (skipped unless `MERC_LIVE=1`): runs the module's plans on real
  warrants and the controlled comparisons.

## Not yet

- Sold prices: no verified source exists; everything is asks.
- Logged-in searches (more bound groups) are out of scope — Vaalytics never uses POESESSID.
- Mysterious Diver has no listings, so no real fixture or market evidence.
- Survey-based rules (family tiers, packages) come from one third-party survey on league day 5 and
  are due for review by 2026-12-10.
