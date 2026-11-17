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
