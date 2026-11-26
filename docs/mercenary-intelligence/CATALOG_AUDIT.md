# Catalog audit (stage C)

Catalog: `src/games/poe1/mercenary/data/catalog-3.30.json`, version **3.30.0-r1**, generated
2026-11-26 by `scripts/poe1-mercenary-catalog.mjs`. Registered in the Update Center as the bundled
dataset `poe1.mercenary-catalog`. Every entry carries the catalog meta (game version 3.30.0,
league Covens, platform pc, generation date, sources); observations, snapshots and valuations
store the catalog version they were made with.

## Shape

- **Family** (canonical slug id): house (PoEDB "Tribe"), attributes and class tag, weapons,
  variants, and the skill rules.
- **Variant** (normal / Infamous, own id `family.infamous`): official warrant type, PoEDB page and
  its own Primary / Secondary / Utility pools. Never merged: they search with different types.
- **Skill rule** per family skill: category, support count class (Low/Medium/High), level range,
  weapon requirement, every support it can roll with the tiers it can roll at, and a stat id only
  where the text is shared by two official stats.
- **Skills** (272) and **supports** (151 identities) tables: canonical id, display text per tier,
  official stat ids. Trarthus skills (12) and Vaal skills are flagged.
- What can roll (catalog) is kept apart from what is on a warrant (`ParsedWarrant`).

Skill rules are written once per family because the generator compares every variant's rules and
found them identical for all 28 families that have both variants; if a variant ever differs it is
written per variant and reported (`meta.problems`).

## Reference figures — verified

| Figure | Brief | Verified | How |
|---|---|---|---|
| Families | 37 | **37** | PoEDB 66 builds − "Bladereach" (skill "Do Nothing", no warrant type) = 65 variants → 37 families; MagicFind "Showing 37 of 37 builds". |
| Active skill names | 272 | **272** | 273 official skill stats; "Herald of Ash" has two (31201, 44334). 272 distinct names on PoEDB build pages, all matched. |
| Support identities | 152 | **151 rollable / 154 on Trade** | Tier prefixes (Lesser/Greater) dropped, "Greater Area of Effect" = T3 of "Increased Area of Effect". PoEDB: 151 identities roll on some build. Trade has 3 more that are on no build: Excommunicate (T1–T3), Gilded Malediction, Gilded Onslaught on Cry. PoEMercPricer's catalog has 152 entries because it lists "Multiple Projectiles" twice (lesser/greater icon), i.e. 151 names. |
| Warrant types | — | **65** | `/api/trade/data/items`, `disc: mercenary_warrant`; 28 families × 2 variants + 8 normal-only (Thunderquiver, Smoulderstrike, Flamehand, Winter Deacon, Frost Ambusher, Flaming Charlatan, Shattersword, Chaplain of the Well) + 1 Infamous-only (Warpriest of the Ruckus). |
| Official stat ids | — | 539 (273 skill + 266 support tier) | `/api/trade/data/stats`, identical to PoEMercPricer's 2026-11-24 copy. |

Every skill of every family and every rollable support tier resolves to exactly one official stat
id (test `gives every skill and every rollable support tier an official stat id`).

## Shared texts (resolved by live searches, 2026-11-26, Covens, securable)

| Text | Stat | Belongs to | Evidence |
|---|---|---|---|
| Herald of Ash | `mercenary.skill_31201` | Chaplain of the Well | `and` search on AbyssalTemplar: 8,245 hits; 44334: 0 |
| Herald of Ash | `mercenary.skill_44334` | Eruptor, Flaming Charlatan | per PoEMercPricer (verified by them live); not re-searched |
| Gilded Extra Targets (Tier 3) | `mercenary.support_37259` | Smite and Vaal Smite (Warpriest, Warpriest of the Ruckus, Chaplain) | Warpriest 1,371 hits, Chaplain 7,021 (5,529 bound to Smite, 1,493 to Vaal Smite); 58471: 0 on both |
| Gilded Extra Targets (Tier 3) | `mercenary.support_58471` | Lightning Arrow, Greater Lightning Arrow (Thunderquiver) | Thunderquiver 1,586 hits; 37259: 0 |

**Discrepancy found:** PoEMercPricer's `trade.rs` maps Smite's Gilded Extra Targets to 58471 (only
Vaal Smite to 37259). Live searches show Smite uses 37259 too; 58471 is the Lightning Arrow one.

## Cross-checks

- **All 29 real warrants** fetched from Trade (one per available warrant type, plus Infamous
  Kineticist/Combatant) parse with every skill and every support **confirmed** against the catalog
  pools and tiers (test `parses one real warrant of every family available on Trade`).
- MagicFind pools for Kineticist and Manyshot equal PoEDB's exactly.
- PoEDB lists some support tiers twice for one skill (e.g. Chain T1/T2 on Frost Blades); duplicates
  are collapsed by the generator.
- Mysterious Diver (both variants): 0 listings on Trade, so no real fixture exists; the catalog is
  from PoEDB only.
- Skill levels: the Ctrl+C text has no skill levels; PoEDB gives a range (1–26). The module never
  shows an inferred skill level.

## Regenerating

`node scripts/poe1-mercenary-catalog.mjs --revision <n>` (cached downloads in
`node_modules/.cache/poe1-mercenary`; delete to refresh). The script lists every mismatch in
`meta.problems` (6 today, all explained above). Bump the revision, run `npm test`, and update this
file. A new patch: `--patch 3.31.0 --league <id>` writes a new `catalog-3.31.json`; old catalogs stay
for history.
