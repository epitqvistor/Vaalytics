# Development setup

Verified environment (2026-11-16):

| Tool                | Version                     |
|---------------------|-----------------------------|
| Windows             | 11 Pro (10.0.26300)         |
| Node.js / npm       | 26.13.0 / 11.20.0           |
| Rust / Cargo        | 1.100.0 (x86_64-pc-windows-msvc) |
| Visual Studio       | 2022 Community (MSVC build tools) |
| WebView2 Runtime    | 157.0.4341.46               |
| Git                 | 2.56.1                      |

## First run
```
npm install
npm run app:dev
```
The first Rust build compiles Tauri and bundled SQLite (a few minutes). Later builds are incremental.

## Checks
```
npm run check:all      # tsc + vitest + cargo test
npm run check:rust     # cargo check
```

## Icons
Source: `src-tauri/icons/source.svg`. Regenerate with
`npx tauri icon src-tauri/icons/source.svg -o src-tauri/icons` (then delete the `android/` and `ios/` folders).

## Visual QA over CDP (dev only)
Launch with WebView2 remote debugging bound to localhost, then drive/screenshot the real webview:
```
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333 --remote-allow-origins=http://127.0.0.1" npm run app:dev
node scripts/cdp.mjs shot.png "document.querySelector('nav button').click(); await new Promise(r=>setTimeout(r,800)); return 1"
```
Never ship with this flag: anything on the machine could control the webview while the port is open.

Dev builds only: `VAALYTICS_DATA_DIR=<folder>` makes the app use that folder for `vaalytics.db`, so a QA run
never migrates or writes the real database (a newer schema would stop an older release build from starting).
Combine with `WEBVIEW2_USER_DATA_FOLDER=<folder>` for a throwaway webview profile.

**Launched from a packaged (MSIX) app — e.g. the Claude desktop app — always set `VAALYTICS_DATA_DIR`.**
Windows virtualizes `%APPDATA%` for processes started from a packaged app: a file written there lands in
`%LOCALAPPDATA%\Packages\<package>\LocalCache\Roaming\…` and is shown *instead of* the real file to every process
started from that package afterwards. Found 2026-11-19: a stale `vaalytics.db` (17.11, schema v7) in that cache was
paired with the real, newer `vaalytics.db-wal`, so dev runs reported "database disk image is malformed" while the real
database (seen by the release build) was intact. To test on real data, copy the real database into the QA folder
with a tool outside the package (Python's `sqlite3` backup API worked) and point `VAALYTICS_DATA_DIR` at it.
