# Architecture overview

Vaalytics is a Tauri 2 application: a Rust host process owns all privileged work
(database, network, hotkeys, clipboard, overlay windows, filesystem), and a
React UI rendered in WebView2 presents it.

```
┌──────────────────────── Rust host (src-tauri) ────────────────────────┐
│ commands.rs  ── thin IPC surface (main window only)                   │
│ settings.rs  ── app + per-game settings repository                    │
│ db.rs        ── SQLite connection, embedded migrations                │
│ diagnostics  ── on-demand CPU/memory sampling (host + WebView2)       │
│ game.rs      ── GameId (poe1 | poe2): key for all game-scoped data    │
│ market/      ── poe.ninja engine: fetch, normalize, cache, history    │
│ trade/       ── official Trade client, GGG rate limits, listings      │
│ overlay/     ── foreground hook, hotkey, clipboard capture, overlay   │
└───────────────────────────────▲───────────────────────────────────────┘
                                │ invoke() via src/core/ipc/commands.ts
┌───────────────────────────────┴──────── React UI (src) ───────────────┐
│ app/          shell, title bar, atmosphere, module views (only place  │
│               that knows both games)                                   │
│ core/         game-context, modules (registry → navigation),          │
│               game-data (versioned patch rules), provenance, market,  │
│               trade, ipc, settings, diagnostics                        │
│ games/poe1    config, sample data, section entry points               │
│ games/poe2    (same; never imports the other game)                    │
│ shared/       components, icons, charts, item-renderer, market-data   │
│               types, views (game-agnostic screens fed by GameConfig)  │
│ browser/      in-app browser                                           │
│ styles/       design tokens                                            │
└────────────────────────────────────────────────────────────────────────┘
```

Modules, navigation and reusable services: [modules.md](modules.md). Patch rules per league: [game-data.md](game-data.md).

## Principles

- **Game isolation.** `GameId` is a required parameter for every game-scoped
  operation, in Rust and TypeScript. The DB enforces valid game ids via CHECK
  constraints. Game modules depend only on `core` and `shared`.
- **Privileged work in Rust.** Network calls to pathofexile.com / poe.ninja will
  be made from Rust (rate-limit state, caching, and the User-Agent live there;
  the UI never handles session cookies).
- **Least privilege IPC.** The `main-window` capability is bound to the `main`
  window label. Future overlay windows get their own narrower capability;
  browser webviews get none.
- **No idle work.** Nothing polls while the user isn't looking. Background sync
  (M4) will be scheduled by source update intervals and cache headers.

## Data storage

- `%APPDATA%\app.vaalytics.desktop\vaalytics.db` — SQLite (WAL). Schema version
  is `PRAGMA user_version`; migrations in `src-tauri/migrations/`.
- Logs: `%LOCALAPPDATA%\app.vaalytics.desktop\logs\` (rotating, 2 MB × 3).

## Current schema (v1)

| Table           | Purpose                              | Scope          |
|-----------------|--------------------------------------|----------------|
| `app_settings`  | app-wide preferences, last game      | global         |
| `game_settings` | per-game preferences (league, etc.)  | `(game, key)`  |
| `market_*`, `price_history` | market cache (schema v2) — see docs/modules/market-data.md | `(game, league, …)` |

## Future games

Adding a game means: a new `GameId` variant (Rust + TS), a CHECK-constraint
migration, and a `src/games/<id>` module. Nothing is stubbed until it is real.

## Screens and game modules

Screens that are identical in structure for both games live in `src/shared/views`
and receive a `GameConfig` (units, categories, links) plus data as props. Each
game module (`src/games/<id>/<section>/index.tsx`) is a tiny entry point that binds
its own config and data to the shared view. `src/app/sections.ts` lazy-loads one
module per (game, section). Where PoE 1 and PoE 2 genuinely differ (e.g. item
parsing in M5), the game modules get their own implementations.

`GameShell` provides `ActiveGameProvider` from its own prop, so a screen that is
animating out after a game switch never observes the new game (or `null`).
Each section is wrapped in an `ErrorBoundary`; a failing section never blanks the app.

An architecture test (`src/games/isolation.test.ts`) fails the build if a game
module imports the other game or if `shared`/`core` import a game module.
