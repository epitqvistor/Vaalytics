# Building a Windows release

```
npm run app:build        # = tauri build → NSIS installer
```

Output: `src-tauri/target/release/bundle/nsis/Vaalytics_<version>_x64-setup.exe`

## Configuration (`src-tauri/tauri.conf.json` → `bundle`)
- Target: **NSIS** `.exe`, `installMode: currentUser` → installs to `%LOCALAPPDATA%\Vaalytics` without admin rights; Start-menu folder and desktop shortcut; Apps & features entry with version/publisher.
- WebView2: `downloadBootstrapper` (Windows 10/11 normally ship WebView2; the installer fetches it only if missing).
- Rust release profile: LTO, `opt-level = "s"`, `panic = "abort"`, symbols stripped → no PDB/debug files are shipped. Frontend is the Vite production build (dev-only gallery tree-shaken out).
- Version: keep `package.json`, `src-tauri/Cargo.toml` and `tauri.conf.json` in sync.

## User data across updates
Settings, the SQLite database and caches live in `%APPDATA%\app.vaalytics.desktop` (logs in `%LOCALAPPDATA%\app.vaalytics.desktop\logs`), outside the install folder. Installing a newer version over an older one, or uninstalling, keeps them (the silent uninstaller does not delete app data).

## Verified build — 0.2.0 (2026-11-16)
| | |
|---|---|
| File | `src-tauri/target/release/bundle/nsis/Vaalytics_0.2.0_x64-setup.exe` |
| Size | 2.31 MB (installed: `vaalytics.exe` 5.6 MB + `uninstall.exe`) |
| Toolchain | Tauri CLI 2.12, NSIS 3.13 (downloaded and hash-verified by the Tauri CLI) |
| Silent install (`/S`) | exit 0 in 1.4 s; Start-menu + desktop shortcut; uninstall entry "Vaalytics 0.2.0 / Vaalytics" |
| Installed app | window in 161 ms; opened existing database (schema v2); idle 30 s: host 0.000 % CPU / 9.4 MB, WebView2 0.003 % CPU / 219 MB |
| Silent uninstall | exit 0; files, shortcuts and uninstall entry removed; user data preserved |

## Code signing
**Not configured.** The installer and executable are unsigned, so Windows SmartScreen will show an "unknown publisher" warning on first run ("More info → Run anyway"). Signing requires a code-signing certificate (OV/EV or Azure Trusted Signing) configured via `bundle.windows.certificateThumbprint` / `signCommand`.

## Not included yet
- Auto-update (Tauri updater plugin + signed update manifests).
- A third-party licence notice file for Vaalytics' own dependencies (npm/cargo) in the installer.
