# Versioned game data

`src/core/game-data/` describes **which rules apply** to a league, per patch, so
modules don't hard-code one patch and a new patch is a new definition — not a rewrite.

## Model

- `PatchDefinition { game, patch, name, leagues[], mechanics, sources[] }`
- `mechanics` are flags/values modules branch on (`scarabs`, `threads`,
  `atlasPassivePoints`, `fates`, `grimFates`, `wickerman`, `itemTierDrops`). Add fields; never
  change the meaning of an existing one.
- Every fact is a `Fact<T> { value, verification: "confirmed" | "unverified", source?, note? }`.
  `confirmed` facts must cite a source (tested). `unverified` facts come from the project brief or
  a single secondary source and must be checked before a module depends on them.

## League → patch

`patchFor(game, league)` / `usePatch(game)`:
1. challenge league listed in a definition → that patch (e.g. `Covens`, `Hardcore Covens` → 3.30);
2. permanent leagues (Standard, Hardcore, SSF, Ruthless) → the current patch (`POE1_CURRENT`);
3. anything else → current patch with `assumed: true` (the UI says so).

Older patches stay as separate definitions (`pre-3.30`), so historical data and rules never
mix with the current league.

## PoE 1 3.30 — Covens of Umbra

| Fact | Value | Status |
|---|---|---|
| Scarabs | removed | confirmed |
| Threads of Creation | replace Scarabs (map-device items adding a league mechanic) | confirmed |
| Atlas passive points | 150 (was 138; tree rebuilt) | confirmed |
| Fates, Viscera, Wickerman | Covens league mechanic | confirmed |
| Grim Fates | from the brief | **unverified** |
| Item Tier drop requirements | some endgame bases need a minimum Item Tier | confirmed |

Sources (checked 2026-11-17): Content Update 3.30.0 notes (patchbot mirror), Maxroll 3.30 patch notes.

## PoE 2

No definitions yet; `patchFor("poe2", …)` returns `null` so no PoE 1 rule is assumed.

## Adding a patch

1. Add a `PatchDefinition` at the top of `poe1.ts` with its challenge league names and sources.
2. Move `POE1_CURRENT` to it. Keep older entries unchanged.
3. Extend `PatchMechanics` if the patch introduces a system modules need; set the field on every
   definition (older ones usually `false`).
4. Update this table and run the tests.
