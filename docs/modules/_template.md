# <Module name>

One sentence: what it is for (same as `summary` in the registry).

| | |
|---|---|
| Registry id | `<id>` · group `<group>` · PoE 1 `<ready/planned>` · PoE 2 `<…/not offered>` |
| UI | `src/games/<game>/<module>/` or `src/shared/views/<Module>View.tsx` |
| Logic | pure `.ts` files next to the view (tested) |
| Data | which services (see docs/architecture/modules.md) and which `DataKind`s |
| Patch rules | which `PatchMechanics` fields it reads |

## Behaviour
What the user can do; filters and sorting; loading, error and empty states.

## Calculations
Formulas and assumptions. Anything estimated is labelled "Estimate" in the UI.

## Data integrity
Sources, caching, rate limits, timestamps. What is never shown (invented prices, drop rates…).

## Tests
What the unit tests cover.

## Not yet
Known gaps.
