# Path of Building integration

Location: `src-tauri/src/pob.rs`, `src/shared/views/ToolsView.tsx`, `src/shared/views/BuildsView.tsx`.

| Game | Product | Repository |
|---|---|---|
| PoE 1 | Path of Building Community | github.com/PathOfBuildingCommunity/PathOfBuilding |
| PoE 2 | Path of Building (PoE 2) | github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2 |

## Detection (no assumed install path)
1. **Path chosen by the user** (per game, `pob.exePath`), if it still validates.
2. **Windows uninstall registry** (HKCU, HKLM, WOW6432Node): entries whose DisplayName contains "Path of Building"; `InstallLocation`/`DisplayIcon` give the folder. This finds custom locations (e.g. `D:\PoB1\…`).
3. **Folder scan** of `%APPDATA%`, `%LOCALAPPDATA%`, `%LOCALAPPDATA%\Programs`, Program Files (both), Documents — subfolders named `Path of Building*`.

A folder counts only if its `manifest.xml` names the expected repository (`…/PathOfBuilding/` or `…/PathOfBuilding-PoE2/`). The manifest also gives the version and branch shown in the UI. Helper executables (`Update.exe`, `Uninstall.exe`) are never chosen.

## Launching — security model
- The frontend never sends a path to execute. `pob_launch(game)` re-runs detection in Rust and validates the executable against the manifest before spawning it with its own folder as working directory.
- Manual selection uses a native file dialog opened **by the Rust command**, so a path can only come from the user's explicit choice; it is validated (right game, not a helper) before saving.
- Duplicate launches: refused if the same executable is already running (process list) or was launched in the last 8 s.

Verified on the development machine (2026-11-16): PoE 1 PoB found via registry at a custom drive path (v2.67.2, beta), PoE 2 PoB found in `%APPDATA%` (v0.22.0, beta); launch, "already running" and double-click guards all behaved as specified.

## Builds
`Documents\Path of Building\Builds` (PoE 1) and `Documents\Path of Building (PoE2)\Builds` (PoE 2), or the custom `buildPath` from PoB's `Settings.xml`. Listed read-only (name, folder, modified). "Open folder" opens Explorer at the computed path.

## Bundling investigation — decision: do not bundle
Investigated 2026-11-16 against the official releases (PoE 1 v2.67.2, PoE 2 v0.23.1):

- **Size:** setup 328–343 MB, portable 383–629 MB per game. Bundling both would make the Vaalytics installer ~300× larger (2.3 MB today).
- **Licensing:** PoB itself is MIT, but its `LICENSE.md` also covers bundled third-party components (PUC-Rio Lua, Lua-cURL/libcurl, LuaJIT, ANGLE, abseil, re2, libsodium, fmtlib, stb, libjpeg-turbo, GIFLIB, Bitstream Vera and Liberation fonts, and a `base64.lua` clause with GPL-style source-availability conditions). Redistribution is permitted but carries notice and source obligations we would have to track per release.
- **Self-updating:** PoB updates itself in place (`Update.exe`, `manifest.xml`). A copy inside Vaalytics' install folder would either break those updates or be overwritten by Vaalytics updates.
- **User data:** PoB stores builds and settings in Documents, independent of where it is installed — no benefit from bundling.

Therefore Vaalytics detects an existing installation, lets the user choose one, and otherwise offers **Official download** (the GitHub "latest release" page), where the user installs it themselves. Nothing is downloaded or installed silently. If bundling is revisited, use the portable zip as an optional, separately-downloaded component with its `LICENSE.md` preserved verbatim and PoB's own updater left intact.

## Known limitations
- Detection reads registry/standard folders only; portable copies elsewhere need "Choose executable…".
- Opening a specific build file in PoB is not implemented (PoB has no documented command-line build argument).
