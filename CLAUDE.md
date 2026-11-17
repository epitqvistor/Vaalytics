# Vaalytics — project rules

Windows desktop companion for **Path of Exile 1** and **Path of Exile 2**.
Stack: Tauri 2 (Rust) · React 19 · TypeScript · Vite · Tailwind CSS v4 · Motion · SQLite (rusqlite, bundled).

## Commands
- `npm run app:dev` — run the desktop app (Vite on :1420 + Tauri)
- `npm run typecheck` — TS check (app + vite config)
- `npm test` — Vitest (frontend unit tests, `src/**/*.test.ts`)
- `npm run test:rust` — Rust unit tests
- `npm run check:all` — all of the above; run after every milestone
- `npm run app:build` — NSIS installer

## Non-negotiable rules
1. **Game isolation.** PoE 1 and PoE 2 never share market data, item definitions, currencies, settings, caches or history. Every game-scoped DB table has a `game` column with a CHECK constraint. `src/games/poe1` and `src/games/poe2` must not import each other; shared code goes in `src/shared` or `src/core`.
2. **No fake data.** Never invent prices, listings, sellers, endpoints or market data. Prototype sample data must be visibly labelled "Sample data". When a source is unavailable, show an honest error/stale state.
3. **No fake features.** Only show navigation/buttons that do something. No placeholders for unsupported games.
4. **Game-safety.** No process-memory reading, DLL injection, game-file modification or anti-cheat bypass. No continuous clipboard monitoring — the clipboard is read only during a user-triggered price check.
5. **Respect external services.** Honour rate limits (`X-Rate-Limit-*` on pathofexile.com), cache headers and source update intervals. Identify with a proper User-Agent. Never bypass restrictions.
6. **Security.** Remote/browser webviews never get IPC capabilities (`src-tauri/capabilities/main.json` is scoped to the `main` window only). Never store credentials in plaintext; never expose cookies/tokens to the React frontend; never ask for passwords.
7. **External software** is never installed or launched without explicit user action.

## Architecture
See `docs/architecture/overview.md`. Key points:
- Frontend calls Rust only through `src/core/ipc/commands.ts` (typed wrappers). Add a command there and in `src-tauri/src/commands.rs` + `generate_handler!` together.
- Rust errors: `AppError` (`src-tauri/src/error.rs`) serializes to a short public message; details go to the log.
- DB migrations: append a new file to `src-tauri/migrations/` and to `MIGRATIONS` in `db.rs`. Never edit a shipped migration.
- Settings keys: `[A-Za-z0-9._-]`, ≤128 chars, JSON values ≤64 KB.

## Screens
- Game-agnostic screens: `src/shared/views/*View.tsx`, fed `GameConfig` + data. Game entry points: `src/games/<id>/<section>/index.tsx`. Register sections in `src/app/sections.ts`.
- In a game environment use `useActiveGame()` (pinned by the shell), never `useGameContext().game`.
- Prototype/sample data must render `<SampleDataNotice />`; sample sellers are `sample_seller_NN`.
- Visual QA of the real app: `scripts/cdp.mjs` (see docs/development/setup.md).

## Market data
- All market data goes through the Rust `MarketEngine` (`src-tauri/src/market`) — never fetch from the frontend. Spec: `docs/modules/market-data.md`.
- Values are stored in the game's base unit (PoE 1 chaos, PoE 2 exalted). Bump `NORMALIZER_VERSION` when normalization output changes.
- Every live-data screen shows `<FreshnessBar>` (source + age + errors). Run `cargo test -- --ignored live_` after touching endpoints.

## Price checker
- Spec: `docs/modules/price-checker.md`. Parsers are per game (`src/games/<id>/parser`) on the shared core; add fixtures for every format change.
- Never send Trade requests without the user's contact (User-Agent); never bypass the rate limiter. Window creation from commands must be `async` (sync deadlocks on Windows).
- The hotkey is registered only while the game window is focused; the clipboard is read only right after the hotkey.

## Crafting
- PoE 1 only, spec `docs/modules/crafting.md`. Mod data comes from RePoE via Rust (`crafting_data`), never hard-coded. Engine changes must keep `engine.test.ts` (model vs exact simulation) passing.

## Release & integrations
- Installer: `npm run app:build` → NSIS (see docs/development/release.md). Bump version in package.json, Cargo.toml and tauri.conf.json together. Unsigned — never claim otherwise.
- Path of Building: never launch a path coming from the frontend; validate via `manifest.xml` (docs/modules/path-of-building.md). Do not bundle PoB.
- Game artwork: original only until approved art exists (docs/modules/game-artwork.md).
- Browser: tabs are child webviews of `main` (docs/modules/browser.md). Never add a `remote` URL list to `capabilities/main.json` — browser tabs would inherit it.

## Design rules
- Full spec: `docs/modules/design-system.md`. Build UI from `@/shared/components` and `<Icon>` (`@/shared/icons`); use motion presets from `@/shared/design/motion` — no ad-hoc durations/easings. Dev builds have a live gallery under Settings → Design system.
- Tokens live in `src/styles/index.css` (`@theme`). Use token classes (`bg-bg-2`, `text-fg-muted`, `border-line`, `text-accent`), never raw hex in components.
- Glass (`glass` utility) for chrome and navigation surfaces only. Data tables, prices and listings use solid surfaces (`bg-bg-2`, `bg-elevated`) for readability.
- Motion: short (150–250 ms), transform/opacity only, `MotionConfig reducedMotion="user"` is set globally. No permanent/looping animations.
- Avoid: neon, heavy gradients, glow, oversized headings, decorative cards.

## Performance rules
- No polling while idle. Sample/refresh only while the relevant view is visible.
- Lazy-load sections (`React.lazy`). Virtualize lists > ~100 rows.
- Measure before optimizing; Settings → Diagnostics shows host + WebView2 CPU/memory.

## Workflow
- After each milestone: `npm run check:all`, `cargo check`, update `docs/`, report what works / what remains / limitations.
- Record significant technical decisions as ADRs in `docs/decisions/`.
