# Loot Intelligence (PoE 1)

Which drops are worth picking up in the selected league, from live poe.ninja
prices, with a show-only loot-filter block to match.

| | |
|---|---|
| Registry id | `loot-intelligence` · group `endgame` · PoE 1 ready · PoE 2 not offered |
| UI | `src/games/poe1/loot-intelligence/index.tsx` |
| Logic | `loot.ts` (tiers, unique bases, filter text) — tested in `loot.test.ts` |
| Data | Market engine snapshots: currency, fragments, essences, fossils, resonators, oils, delirium orbs, divination cards, omens, tattoos, artifacts, unique weapons/armours/accessories/jewels/flasks. `DataKind` market; thresholds are user data |
| Patch rules | none yet (see "Not yet") |

## Behaviour

- **Thresholds** (Top / Valuable / Pick up, in Chaos Orbs; default 100 / 10 / 1), saved per game
  (`loot.thresholds`). Applied with "Apply"; Top ≥ Valuable ≥ Pick up is enforced.
- **Currency & stackables** — every priced stackable by tier, filter by tier and category, search.
  Variant rows are left out (a filter can't tell variants apart).
- **Unique bases** — uniques grouped by base type (poe.ninja `baseType`, stored since normalizer v4 /
  migration 0003). *Floor* = cheapest unique on the base with ≥ 5 listings (what an unidentified
  drop is at least worth); the base's tier comes from the floor. *Chase* = its best unique reaches
  Top. Linked/variant rows and thin listings never set the floor; bases with only thin data show
  "thin data".
- **Loot filter** — `Show` blocks for Top, Valuable and Pick up (stackables by `BaseType ==`,
  unique bases with `Rarity Unique`), with a header naming the league and price time. Nothing is
  hidden; items below the thresholds fall through to the user's own filter. Copy and paste above
  the first rule of a `.filter` file.

## Data integrity

- Tiers come from current prices only — no drop rates, no invented values. Prices show their
  source and age; the filter header records the price time.
- No extra requests: the same cache-first snapshots as the Currency Tracker and Market Intelligence.

## Limitations / not yet

- **3.30 Item Tier drop requirements** for endgame bases are not shown: RePoE (checked 2026-11-17)
  has no item-tier field, and no other machine-readable source is wired in.
- Some uniques drop only from specific bosses or league content; poe.ninja doesn't say which, so
  a base's floor can be higher than what a random world drop of that base is worth.
- Rare bases (e.g. high-value influenced/fractured bases), cluster jewels, maps and gems aren't tiered yet.
- The filter block uses fixed styles; no per-tier sound/colour customisation yet.
