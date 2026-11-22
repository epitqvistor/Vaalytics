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

## Performance measurements (dev only)
`scripts/perf-measure.mjs` measures one build under fixed conditions so before/after numbers are comparable:
startup (CDP target, first rendered shell), idle CPU/RAM of the host and its WebView2 processes (60 s), idle on
Location Atlas, median IPC times of the heaviest reads, first visit of every module in both games, and repeated
navigation rounds (JS heap after a forced GC, DOM nodes, memory) for leak checks.

1. Build a binary that honours `VAALYTICS_DATA_DIR` and embeds the frontend: `npx tauri build --debug --no-bundle`,
   then copy `src-tauri/target/debug/vaalytics.exe` somewhere stable (one copy per build you compare).
2. Make `$PERF_DIR/qa-base/` a **copy** of a data folder (database via the `sqlite3` backup API as above, plus
   `crafting/` and the `trade-*.json` caches, so no run starts with a cold download).
3. `PERF_DIR=<folder> node scripts/perf-measure.mjs <exe> <label> [navRounds] [idleSecs]` → `result-<label>.json`.
   Alternate builds (A, B, A, B) and compare medians; market data may refetch from poe.ninja during a run.

Debug-build CPU numbers are higher than a release build's; compare like with like. Logs of these runs go to the
normal log folder (`%LOCALAPPDATA%\app.vaalytics.desktop\logs`).
