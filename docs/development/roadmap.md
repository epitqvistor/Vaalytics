# Roadmap

| Milestone | Scope | Status |
|-----------|-------|--------|
| 1 Foundation | Tauri project, architecture, SQLite + migrations, per-game settings, diagnostics, logging, docs, CLAUDE.md, git | **done** |
| 2 Design system | tokens, typography, spacing, glass surfaces, buttons/inputs/nav/modal, motion standards, icon set, custom title bar | **done** |
| 3 Visual prototype | Game Selection, PoE 1/2 dashboards, Price Checker, Currency Tracker, Browser, Settings (labelled sample data) | **done** |
| 4 Application foundation | market data engine (poe.ninja), cache & history tables, league selection, background sync | **done** |
| 5 Price checker | item parser (PoE 1/2), trade query builder, trade API client + rate limiter, listings, overlay window, global hotkey | **done** (in-game path unverified, see price-checker.md) |
| 6 Other modules | Browser, External Tools, Builds, Crafting, alerts (Currency Tracker + watchlist done in M4) | next |
| 6a UI rework & release | liquid-glass redesign, original game artwork, Path of Building integration, Builds list, Trade shortcuts, NSIS installer 0.2.0 | **done** |
| 6b Browser | embedded WebView2 tabs, address bar/search, popups as tabs, login fallback, isolation verified (0.2.3) | **done** |
| 6c Crafting 1 | PoE 1 calculator: RePoE data, weights/tiers, targets, Chaos / Alt-Aug-Regal / Essence / Fossil optimizer, paste, PoB export (0.3.0) | **done** |
| 6d Crafting 2 | currency emulator (Shift auto-roll, session cost), Monte Carlo worker with histogram, PoB export of the crafted item (0.4.0) | **done** |
| 6e Crafting 3 | Harvest tag reforges, Eldritch currency, bench + metamods, next-step planner (0.5.0) | **done** |
| 7 Module foundation | registry-driven navigation (Overview / Economy / Endgame / Character / Tools), planned-module pages + toggle, versioned league-aware game data (3.30), provenance model, module docs/template (0.7.0) | **done** |
| 8a Market Intelligence | category overview, movers, liquidity, in-app price alerts (0.8.0) | **done** |
| 8b Loot Intelligence | value tiers for stackables, unique-base floors (poe.ninja baseType, migration 0003), show-only loot-filter block (0.9.0) | **done** |
| 8c Farming Lab | session recorder (timer, maps, priced loot/costs), strategy comparison, history (0.10.0, migration 0004) | **removed in 0.20.2** (no longer needed; `farming_sessions` table kept, data untouched) |
| 8d Map Lab | paste a map, mods grouped by user rules (+ marked defaults), rewards verbatim, pasted-maps comparison (0.11.0) | **removed in 0.20.2** (no longer needed) |
| 8f REGEX | search-string generators from 3.30 data (maps, vendor, items, flasks, jewels, expedition, heist, tattoos, threads), 250-char split, manual edit, library + 8 quick slots (migration 0005), presets, import/export, reverse lookup, test against item (0.12.0) | **done** |
| 8g Session Intelligence | automatic PoE 2 session tracking: process detection, incremental Client.txt reader (verified format), area/map tracking, history, analytics, summary, diagnostics (0.13.0, migration 0006) | **done** |
| 8h Loot Journal | automatic capture of PoE 2 item copies (clipboard listener scoped to the focused game), categorisation, fingerprint de-duplication, poe.ninja valuation with history, session association, library/details/analytics, import/export (0.14.0, migration 0007) | **done** |
| 8e 3.30 modules | Thread Planner, Atlas Planner, Fate Planner — each needs a verified 3.30 data source first | next |
| 6f Remaining | price alerts, auto-update, code signing, third-party licence notice | later |
