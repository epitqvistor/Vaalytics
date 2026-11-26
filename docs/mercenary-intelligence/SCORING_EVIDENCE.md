# Scoring evidence (stage F)

Vaalytics has **no score that becomes a price**. Rules (`src/games/poe1/mercenary/rules.ts`,
version `3.30-r1`, patch 3.30.0, review by 2026-12-10) decide three things only:

1. **Which skill carries the value** and which of its supports are searched bound to it (value
   packages).
2. **Which other skills must match** in the comparable search: a known downside the warrant has is
   required (`and`) so comparables share it; a downside it lacks is excluded (`not`); a positive
   partner it has is required.
3. **Explanations and premium conditions** (a "Premium" category needs every condition *and*
   comparable evidence; an active downside blocks it).

Rules are family-specific; no universal formula. Supports are evaluated in the context of their
own skill and tier (package gates name the skill and a minimum tier).

## Evidence register

Every rule cites ids from `EVIDENCE` in `rules.ts` (shown in the UI with source, date, n, link):

| Id | Kind | Claim (short) | n |
|---|---|---|---|
| pmp-tier | survey | tier bands from the dearest 50 asks | — |
| pmp-kin-kboc | survey | KBoC present 200 div vs absent 3c | 108 |
| pmp-kin-pack | survey | KBoC + Return T3 + GMP T3, top-share 1.00 | 22 |
| pmp-kin-bolt | survey | KBoC + Kinetic Bolt 150 div, top-share 0.79 (undecided) | 19 |
| pmp-kin-gkb | survey | with/without Greater Kinetic Blast both 200 div (thin) | 14 |
| pmp-many-vis / -pack / -icicle | survey | VIS gate; VIS + Return + Mirror Arrow; Icicle Rain contradiction | 140 / 40 / 16 |
| pmp-comb-core / -pack / -helix / -wild | survey | FB + Static Strike; FB package; Helix brick; Wild Strike contradiction | 51 / 12 / 37 / 23 |
| pmp-chap, pmp-cruel, pmp-thunder, pmp-sniper, pmp-stormhand, pmp-swift, pmp-smoulder, pmp-bastion, pmp-reverend, pmp-bladeamb | survey | per-family packages / downsides | see rules.ts |
| pmp-generic | survey | no feature separates top from bottom asks | — |
| obs-kin-bolt-cmp, obs-many-icicle-cmp, obs-comb-helix-cmp | observation | controlled with/without comparisons (see COMPLETION_REPORT) | 40 each |
| obs-kin-bolt-count | observation | 309 package listings, 221 without Kinetic Bolt; two cheapest carry it | 309 |
| patch-330-merc | patch-note | 3.30 mercenary changes | — |
| op-aoeah-329 | opinion | community 3.29 view on Kinetic Bolt / Icicle Rain | — |

## Negative rules (each with reason, basis, observations, confidence, patch, review date)

| Rule | Status | Basis | Confidence | Why |
|---|---|---|---|---|
| kineticist.kinetic_bolt (beside KBoC) | **active** (promoted in r1 after the controlled comparison) | market | medium | same package: with KB lowest-asks median 1 div (97 listings) vs without 10 div (209); survey 0.79; opinion (AI skill choice) |
| combatant.spectral_helix | active | market | medium | 5c / 3c next to FB / WS (n = 37) |
| bastion.impenetrable_bastion | active | market | medium | 10c, top-share 0.32 |
| fallen_reverend.frostblink | active | market | medium | 40c vs 7.5 div (n = 40) |
| manyshot.icicle_rain | **unverified** (conflicting) | market | low | survey dearest asks 175 div, 0.88 (no penalty) vs controlled comparison lowest asks 12c with / 5 div without — matched in searches, never blocks Premium |
| combatant.wild_strike (beside FB) | **contradicted** | market | low | 100 div, 0.87 — shown, never applied |
| thunderquiver.galvanic_arrow | unverified | market | low | undecided (0.64) |

## Staging and promotion

New rules never overwrite bundled ones. The Research tab runs a **controlled comparison** — the
family's value package searched twice, with (`and`) and without (`not`) one skill — and computes
the median of the lowest instant-buyout asks on each side. If both sides have at least the
exploratory threshold of asks and the medians differ by ≥ 30 %, the result can be **staged**
(`mercenary_rule_candidates`, per league, with full evidence JSON: totals, medians, sample classes,
divine rate, Trade links, method, time). The user then **validates** and **promotes** (or rejects).
Promoted rules are added beside the bundled set for that league, labelled "your promoted rule", and
only affect search planning and explanations. A re-run refreshes a candidate's evidence but never
changes its review status.

## Sample thresholds (configurable, Research tab)

< 5 insufficient · 5–7 exploratory · 8–14 limited · 15–29 moderate · ≥ 30 stronger.

## Regression tests

`valuation.test.ts` has one test per family rule set: every rule names a skill the family can roll,
every package gate is attainable on its skill at the gated tier, every evidence id exists, negative
rules carry a reason, and every rule is tagged with patch 3.30.0. Contradicted rules are tested to
never apply. The test caught one wrong skill id during development (Combatant's Helix is
`spectral_helix`, not the Trarthus variant).

## Live re-verification (2026-11-26)

See [COMPLETION_REPORT.md](COMPLETION_REPORT.md#calibration) for the controlled comparisons run for
Kinetic Bolt, Spectral Helix and Icicle Rain and the resulting decisions.
