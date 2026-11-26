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

## Application updates
**Not implemented.** Game-data updates are handled in-app by the Update Center (no reinstall needed,
docs/modules/update-center.md); the Update Center's Settings tab shows the installed version and this status.
A safe self-updater (`tauri-plugin-updater`) needs, before any code:
1. **A public release source.** Releases are published to `epitqvistor/Vaalytics`, which is **private**
   (checked 2026-11-26): anonymous requests can't read its release assets, and a GitHub token must never be
   embedded in the app. Options: a separate public repository (or static host) that holds only the installer
   and `latest.json`, or making the repository public.
2. **An update-signing keypair** (`npx tauri signer generate`). This is separate from Windows code signing and
   doesn't remove the SmartScreen warning. The public key goes into `tauri.conf.json` (`plugins.updater.pubkey`);
   the **private key and its password stay with the maintainer** (never committed, never in CI logs) and are
   given to the build via `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
   `bundle.createUpdaterArtifacts` then produces the `.sig` next to the NSIS installer.
3. **UX rules:** check on startup/on demand only (configurable, honouring GitHub rate limits), show the release
   notes, download and install only after an explicit click, never silently.
User data (database, settings, league profiles, history) lives in app data and survives installs either way.

## Not included yet
- Application self-update (see above).
- A third-party licence notice file for Vaalytics' own dependencies (npm/cargo) in the installer.
