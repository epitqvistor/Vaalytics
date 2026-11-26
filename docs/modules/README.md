# Module documentation

One file per major module, added when the module is implemented (start from [_template.md](_template.md); architecture in [../architecture/modules.md](../architecture/modules.md)). Each describes:
responsibilities, public interface (IPC commands / exported functions), data it
owns (tables, settings keys), and known limitations.

| Module | Location | Doc |
|--------|----------|-----|
| Game context | `src/core/game-context`, `src-tauri/src/game.rs` | see ADR 0002 |
| Settings | `src-tauri/src/settings.rs` | keys: `app.lastGame` (app); per-game keys added per module |
| Diagnostics | `src-tauri/src/diagnostics.rs`, `src/core/diagnostics` | on-demand sampling of host + WebView2 CPU/memory |
| Browser | `src/browser`, `src-tauri/src/browser.rs` | [browser.md](browser.md) |
| Crafting (PoE 1) | `src/games/poe1/crafting`, `src-tauri/src/crafting.rs` | [crafting.md](crafting.md) |
| Market Intelligence | `src/shared/market-intel` | [market-intelligence.md](market-intelligence.md) |
| Loot Intelligence (PoE 1) | `src/games/poe1/loot-intelligence` | [loot-intelligence.md](loot-intelligence.md) |
| Ultimatum Checker (PoE 1) | `src/games/poe1/ultimatum` | [ultimatum-checker.md](ultimatum-checker.md) |
| Deck Intelligence (PoE 1) | `src/games/poe1/deck-intelligence`, `src-tauri/src/decks/` | [deck-intelligence.md](deck-intelligence.md) |
| Update Center (both games) | `src/shared/views/update-center`, `src/core/updates`, `src-tauri/src/updates/` | [update-center.md](update-center.md) |
| REGEX (PoE 1) | `src/games/poe1/regex`, `src-tauri/src/regex_library.rs` | [regex.md](regex.md) |
| Session Intelligence (PoE 2) | `src/games/poe2/session-intelligence`, `src-tauri/src/session/` | [session-intelligence.md](session-intelligence.md) |
| Loot Journal (PoE 2) | `src/games/poe2/loot-journal`, `src-tauri/src/loot/` | [loot-journal.md](loot-journal.md) |
| Campaign Intelligence (PoE 2, complete, stages 1–7) | `src/games/poe2/campaign-intelligence`, `src-tauri/src/campaign/` | [campaign-intelligence.md](campaign-intelligence.md) |
| Location Atlas (PoE 1, stages 1–5 of 8) | `src/games/poe1/location-atlas`, `scripts/poe1-campaign-data.mjs` | [location-atlas.md](location-atlas.md) |
| Act Tracker (PoE 1, complete, phases 1–7) | `src/games/poe1/act-tracker`, `scripts/poe1-act-tracker-data.mjs` | [act-tracker.md](act-tracker.md) |
