# Show / hide Vaalytics over the game

One key (default **Insert**) brings the Vaalytics main window up over Path of Exile; the same key puts it away and returns to the game. Shell feature (both games), not a navigation module.

| | |
|---|---|
| Logic | `src-tauri/src/main_window.rs` (toggle, debounce, monitor), registration in `src-tauri/src/overlay/mod.rs` (`on_foreground`) |
| Windows API | `src-tauri/src/overlay/win.rs` — `GetForegroundWindow`, `SetForegroundWindow`, `GetWindowRect`, `IsWindow` |
| UI | Settings → General → *Show over the game* (`src/core/settings/SettingsPage.tsx`) |
| Command | `main_window_set_hotkey` (`mainWindowSetHotkey`) — validates, checks clashes, saves, re-registers immediately |
| Setting | app setting `mainWindow.hotkey` (string, `""` = off, missing = `Insert`). App-wide: it manages our window, not game data. |

## Behaviour

- **Press in game** (or while Vaalytics is behind / minimised): `main` is restored, shown, moved onto the monitor the game window is on (centred, only if its centre is on another monitor; a maximised window is re-maximised there) and brought to the foreground. The game window's handle is remembered.
- **Press while the main window is in front**: the foreground is handed back to the remembered game window (if it still exists and is still a PoE window), then `main` is **minimised**.
- A press while another Vaalytics window (price-check overlay) is focused shows the main window.

### Decisions

- **Not always-on-top.** Vaalytics is a large window; pinned on top it would cover the game even after the user clicks back into it. Without it, clicking the game puts the game in front, and the next Insert brings Vaalytics back (a press hides only when the main window is actually in front).
- **Minimise, not `hide()`.** A hidden window has no taskbar button — if the user forgot the key, the app would look gone. Minimise keeps the taskbar entry. Never close: closing `main` exits the app (`on_window_event`, docs/architecture/overview.md → App lifecycle).
- **Registration policy.** Registered only while a Path of Exile window **or a Vaalytics window** is the foreground window (event-driven foreground hook, no polling). Other apps keep their Insert. While Vaalytics is focused only this key is registered (that's what lets it hide Vaalytics) — so inside Vaalytics, Insert does not reach text fields (it only toggles overwrite mode there anyway).
- **One press = one toggle.** The plugin registers with `MOD_NOREPEAT` (held key fires once) and `main_window` ignores presses within 250 ms of the last one.
- **Clashes.** Saving rejects reserved keys (plain letters/digits/Space…, Escape, Ctrl+C, Alt+F4 — same rules as the Loot Tracker keys) and keys already used by a game feature (price check of either game, Act Tracker, Deck Intelligence, Loot Tracker). If a feature key is later set to the same combination, the feature wins in that game and Settings shows why.

## Game safety

Only our own window is managed. No input is sent to the game: focus uses `SetForegroundWindow` directly — tao's `set_focus` is deliberately avoided because its fallback injects a fake Alt key press. No memory reading, no game files. If Windows refuses `SetForegroundWindow` (foreground lock — seen in testing with a synthetic key press), Vaalytics retries once while briefly attached to the foreground window's input queue (`AttachThreadInput`, detached right after). That shares keyboard *state*; it sends no input. If it still fails, the window is restored but may only flash in the taskbar (logged).

## Limitations

- **Exclusive Fullscreen cannot show any overlay or window over the game** — Windows switches away from the game (it minimises) instead. Use *Windowed* or *Windowed Fullscreen* (borderless). Also stated in Settings.
- A game running as administrator does not deliver hotkeys to a non-elevated Vaalytics (same as price check).

## Tests

- Unit (`main_window.rs`): hide/show decision, debounce window, default key allowed.
- Verified 2026-11-26 in the real app (debug build, own data dir) against a stand-in window with class `POEWindowClass` and title `Path of Exile` (1600×900, windowed), Insert sent with `keybd_event`: Insert in "game" → Vaalytics in front; Insert in Vaalytics → game in front, Vaalytics minimised; repeated 3×; game clicked while Vaalytics visible behind it → Insert brings Vaalytics back; with another app (Claude) in the foreground Insert did nothing (not registered). Settings: saving Ctrl+D / Ctrl+Shift+T is rejected as a clash, `A` as reserved, F10 registers at once, Insert restored.
- Not verified: a running Path of Exile client, a second monitor (the move-to-game-monitor path), a physical key press.
