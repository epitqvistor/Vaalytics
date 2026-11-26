# Mercenary Warrants — research report (stage B)

**Scope.** What makes a PoE 1 Mercenary Warrant sell, how to find comparable listings, and how
reliable each source is. Not build advice. **Date** 2026-11-26. **Version** PoE 1 3.30.0 (Covens of
Umbra, launched 2026-11-13; hotfixes to 3.30.0d Hotfix 3 contain no mercenary changes). **League**
`Covens` (trade id). Allflame / 3.29 is history only. Sources and reliability: [SOURCES.md](SOURCES.md).

## 1. Sources and reliability (summary)

- **Official, structured:** Trade API data (stats, items, leagues) and live searches — the only
  price evidence used. Patch notes — mechanics context only.
- **Structured game data:** PoEDB (pools, supports, tiers, houses, weapons) — basis of the catalog,
  cross-checked against Trade stats and 29 real warrants (100 % confirmed). MagicFind agrees on the
  37 builds and the pools checked.
- **Tool methodology:** PoEMercPricer (MIT) — the most complete public methodology and a 3.30 survey
  of asks (day 5); xddbsns — cheapest-exact-configuration method (data not readable); poe.run,
  PoEden (PoEden outdated: 3.29 catalog).
- **Opinion:** guides (aoeah 3.29 — outdated, mmoso, vhpg). Reddit could not be read (gap).

## 2. Catalog findings

37 families (65 warrant types: 28 with both variants, 8 normal-only, 1 Infamous-only), 272 skills,
151 rollable support identities (154 on Trade; Excommunicate, Gilded Malediction and Gilded
Onslaught on Cry roll on no build), 539 official stat ids. Two texts map to two stats each (Herald
of Ash; Gilded Extra Targets), resolved by live searches — including one error in PoEMercPricer's
mapping. Details: [CATALOG_AUDIT.md](CATALOG_AUDIT.md).

Real 3.30 Ctrl+C layout (decoded from Trade `extended.text`): header (`Item Class: Map Fragments`,
`Rarity: Normal`, `Mercenary Warrant`), mercenary name, `Build:` + `Mercenary Level:`, one section
per skill with `Support (Tier: N)` lines bound to it, usage text, `Note`. PoEDB's extra lines
(`Limit`, `Portal`, `Area Level: 83`) do not appear in real copies; the parser ignores them anyway.
Real warrants at level 79 exist (Fallen Reverend fixture), so 83 is not assumed.

## 3. 3.30 changes that matter (official patch notes, 2026-11-11)

Hired mercenaries deal up to 20 % less attack damage at level 83, scale damage reduction less, get
more life, and take −30 % / −60 % resistances in level 46–67 / 68+ areas; Kinetic Blast's Arcane
Might is 150 %; Kinetic Blast of Clustering's secondary radius bug is fixed; Brutality no longer
blocks elemental/chaos damage; Pulverise, Trap and Mine Damage and Ailment Damage supports changed;
warrants now open the Proving Grounds (area level 83). These are context; no value rule is derived
from a patch note alone.

## 4. Valuable families (asks, not sales)

From the PoEMercPricer survey of the 50 dearest + 20 cheapest asks per warrant type (2026-11-18, day
5; median of the dearest 50): **premium** Chaplain of the Well (300 div), Manyshot, Kineticist (200),
Combatant, Thunderquiver (100), Cruel Mistress, Sniper (50); **high** Withertouch, Swiftblade,
Smoulderstrike, Blade Ambusher, Bladebitter, Warpriest (15–30); the rest mid/floor; Mysterious Diver
and Warpriest of the Ruckus no data. Listing depth differs hugely (Manyshot/Combatant/Kineticist/
Chaplain ≥ 10,000 listings today vs ~900 for Flaming Charlatan; Mysterious Diver 0), and the cheap end
of every book sits at a few chaos — the family alone does not make a warrant valuable.

## 5. Skill combinations (value is on one skill's package)

| Family | Value carrier (package) | Evidence |
|---|---|---|
| Kineticist | Kinetic Blast of Clustering + Return T3 + GMP T3 | KBoC present 200 div vs absent 3c (survey, n=108); package top-share 1.00 |
| Manyshot | Vaal Ice Shot + Return, with Mirror Arrow | VIS present 200 div vs absent 5c (n=140) |
| Combatant | Frost Blades + Return T3 + Chain + EDWA, with Static Strike | FB + Static Strike 100 div (n=51) |
| Chaplain of the Well | Abyssal Spray + Return + Faster Casting | 300 div, top-share 0.94 (n=18) |
| Cruel Mistress | Soulrend of Reaping + GMP + Return | 50 div, top-share 1.00 (n=20) |
| Thunderquiver | Lightning Arrow + Return | 100 div (n=70) |
| Sniper | Tornado Shot + Arrow Nova | 50 div, 0.97 (n=64) |

Pairs are unordered (xddbsns); the same skills with a support on a different skill are a different
warrant (tested).

## 6. Support combinations

Supports only matter on their own skill and tier: Return T3 and GMP T3 on KBoC, Return + Faster
Casting on Abyssal Spray, CDR + More Duration on Swiftblade's Rallying Cry (30 div, below premium).
GMP on Abyssal Spray is not priced (0.68). Lesser tiers of a gate do not satisfy a T3 gate.

## 7. Negative combinations (re-verified, not copied)

| Rule | 3.29 view | 3.30 evidence | Status in Vaalytics |
|---|---|---|---|
| Kinetic Bolt on Kineticist (beside KBoC) | brick | survey undecided (0.79, n=19); controlled comparison: with 1 div vs without 10 div (lowest asks, n=20 each) | **active** (medium) |
| Spectral Helix on Combatant | brick | 5c / 3c beside FB / WS, top-share 0.47 / 0.25 (n=37) | active |
| Icicle Rain on Manyshot | −40 brick | survey 175 div, 0.88 (n=16) vs controlled comparison 12c with / 5 div without (lowest asks) | **unverified — conflicting**; matched in searches, never blocks Premium |
| Wild Strike beside Frost Blades | penalty | 100 div, 0.87 | contradicted — not applied |
| Frostblink on Fallen Reverend | — | 40c vs 7.5 div, 0.47 (n=40) | active |
| Impenetrable Bastion | money skill | 10c, 0.32 | active (Prismplate is the carrier) |
| Galvanic Arrow (Thunderquiver), Brutality on Tornado Shot, Battlemage's Cry | bricks | undecided | not applied |

## 8. Sample methodology

PoEMercPricer's "top-share" compares where a feature's listings sit (dearest 50 vs cheapest 20)
and needs n ≥ 8; xddbsns prices the cheapest exact configuration and drops thin sets. Vaalytics
uses neither as a price: it searches comparables per level, keeps the lowest 20 asks, filters with
reasons and labels sample size (5 / 8 / 15 / 30 thresholds). Controlled with/without comparisons
use `and` / `not` skill groups next to the same bound package. See
[MARKET_METHODOLOGY.md](MARKET_METHODOLOGY.md).

## 9. Limitations

Asks only (no sales source exists); one bound skill group per anonymous search; lowest 20 asks per
level; survey evidence is one third-party snapshot from league day 5; Reddit not readable; Mysterious
Diver has no listings; poewiki blocked; xddbsns numbers not readable.

## 10. Confirmed vs uncertain vs unverified

- **Confirmed (live / official):** catalog counts, stat ids and their shared-text owners, warrant
  types, Ctrl+C layout, anonymous one-bound-group limit and complexity behaviour, `and`/`not` skill
  groups, rate-limit rules, 29 real warrants parse fully.
- **Uncertain (survey, n ≥ 8, one snapshot):** family tiers, value packages, Spectral Helix,
  Frostblink and Impenetrable Bastion downsides, contradicted Icicle Rain / Wild Strike penalties.
- **Unverified:** Icicle Rain (dearest vs cheapest asks disagree), Greater
  Kinetic Blast as a premium partner (n = 7), Galvanic Arrow, Brutality on TS, community opinions.

## 11. Recommendations

Re-run the controlled comparisons weekly (Research tab) and stage what holds; re-survey family tiers
after the league settles (review by 2026-12-10); regenerate the catalog on every patch; never treat
a package rule as a price.
