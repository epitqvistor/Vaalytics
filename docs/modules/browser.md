# Built-in browser

Tabbed web browser inside the Browser section, for the official Trade site,
poe.ninja, wikis and anything else the user opens.

| | |
|---|---|
| Rust | `src-tauri/src/browser.rs`, commands in `commands.rs` |
| UI | `src/browser/BrowserView.tsx`, `address.ts`, `links.ts` |
| Data | none — no tables, no settings keys; cookies live in the WebView2 profile |

## How it works

- Each tab is a WebView2 **child webview** (`Window::add_child`, Tauri `unstable`
  feature) labelled `browser-<tabId>`, placed in the `main` window exactly over the
  page-area `<div>` of the Browser section.
- The UI measures that element (`getBoundingClientRect`) and keeps the native view
  aligned via `ResizeObserver`, window `resize`, and one delayed sync after the
  page-enter animation (320 ms).
- Only the active tab is visible (`browser_show_only`). Leaving the section hides
  every browser webview; webviews (and their history) stay alive until the tab is
  closed or "Start page" is pressed.
- The tab list is a module-level store (`useSyncExternalStore`), so tabs survive
  switching sections. It is not persisted across app restarts.
- Native events reach the UI as `browser:event` (emitted to `main` only):
  `navigated`, `loading`, `title`, `newTab`.
- Popups (`target=_blank`, `window.open`) are denied as windows and opened as a
  new tab instead.

## IPC commands

| Command | Purpose |
|---|---|
| `browser_open(tab, url, bounds)` | create or reuse a tab's webview and navigate |
| `browser_set_bounds(tab, bounds)` | reposition / resize |
| `browser_show_only(tab \| null)` | show one tab, hide all others |
| `browser_action(tab, back\|forward\|reload)` | history / reload |
| `browser_close(tab)` | destroy the webview |
| `browser_open_external(tab)` | open the tab's current URL in the default browser |

All are `async` (window/webview creation from a sync command deadlocks on Windows).

## Security

- **No IPC for web pages.** Capabilities are `local: true` with no `remote` URL
  list, so remote origins inside the `main` window get no command access.
  Verified by calling `get_app_setting`, `pob_launch` and `plugin:opener|open_url`
  from a loaded remote page — all rejected. **Never add a `remote` entry to
  `capabilities/main.json`**: browser tabs live in the `main` window and would
  inherit it.
- **Web URLs only.** `parse_web_url` accepts `http`/`https`; `file:`,
  `javascript:`, `data:`, `tauri:` and custom schemes are rejected, both when
  opening and in `on_navigation` (`about:` is allowed for blank frames).
- **Tab ids are validated** (`[A-Za-z0-9-]`, ≤32) so a tab can never address the
  `main` or `overlay` webview.
- **Credentials.** Users sign in on the site itself. Cookies stay in the WebView2
  profile (so a pathofexile.com login persists) and are never read by Vaalytics or
  passed to the React UI. `browser_open_external` only opens the validated current
  URL of the tab — it is the fallback for sign-in providers that refuse embedded
  browsers.
- Browser security features are not disabled.

## Address bar

`toUrl` (`address.ts`): `http(s)://…` is used as-is, a bare domain gets
`https://`, anything else becomes a Google search; other schemes are refused.

## Known limitations

- The native page is drawn **above** the React UI. Dropdowns, toasts and modals
  that overlap the page area are hidden behind it while a page is open.
- Tabs are not restored after restart; no bookmarks, downloads UI or zoom control.
- Login persistence has not been verified with a real pathofexile.com sign-in.
