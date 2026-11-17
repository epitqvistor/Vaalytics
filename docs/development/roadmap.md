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
| 6f Remaining | price alerts, auto-update, code signing, third-party licence notice | later |
