# ADR 0002 — Game data isolation

Status: accepted · 2026-11-16

## Context
PoE 1 and PoE 2 have different items, currencies, leagues, trade endpoints and
market sources. Mixing them would produce wrong prices.

## Decision
- A single `GameId` enum (`poe1`, `poe2`) defined in Rust (`game.rs`) and mirrored
  in TS (`core/game-context/games.ts`).
- Every game-scoped table has `game TEXT NOT NULL CHECK (game IN (...))` and the
  game is part of the primary key or unique index.
- Every game-scoped command takes `game` as an explicit argument — no hidden
  "current game" state in Rust.
- `src/games/poe1` and `src/games/poe2` never import each other. Shared logic is
  promoted to `src/shared` or `src/core` deliberately.

## Consequences
Some code is duplicated between game modules where formats differ (e.g. item
parsing rules). That is intended.
