# ADR 0001 — Technology stack

Status: accepted · 2026-11-16

## Decision
Tauri 2 (Rust) + React 19 + TypeScript + Vite + Tailwind CSS v4 + Motion + SQLite via `rusqlite` (bundled).

## Notes
- **Tauri 2, not 3.** Tauri 3 is in alpha on crates.io; we stay on stable 2.x.
- **rusqlite (bundled) instead of `tauri-plugin-sql`.** Database access stays in
  Rust behind typed commands rather than exposing raw SQL to the webview. The
  bundled build pins a known SQLite version and needs no system library.
- **sysinfo** (only the `system` feature) for on-demand diagnostics.
- **tauri-plugin-log** for rotating file logs.
- **TypeScript 7** (native compiler) for fast type checks; Vite/Vitest do their
  own transpilation so TS is only used for checking.
- **No router library yet.** The shell has few sections; a state-based switch is
  enough. Revisit if deep-linking is needed.
- Package manager: npm (pnpm not installed; no need for it).
- **reqwest with `native-tls`** (M4): uses Windows SChannel and the OS certificate store;
  avoids the C/asm toolchain that reqwest's default rustls/aws-lc backend needs.
- **No virtualization or charting library**: a fixed-row-height `VirtualRows` and SVG charts cover current needs.
