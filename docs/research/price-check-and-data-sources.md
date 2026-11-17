# Research notes — price checking and market data

Status: **verified 2026-11-16** for the items marked implemented; see docs/modules/price-checker.md. Each item marked _verify_ must be confirmed against the
current Awakened PoE Trade (APT) source, GGG developer docs and poe.ninja before
Milestones 4–5 depend on it. Nothing here is implemented yet.

## Price-check flow (APT reference, to study in M5)
- APT registers a global hotkey (default Ctrl+D) with a low-level keyboard hook,
  then *simulates* the in-game copy shortcut while the item is hovered, waits for
  the clipboard to change, reads it once, and restores the previous clipboard
  contents. _verify_: exact key sequence (Ctrl+C vs. Ctrl+Alt+C "advanced
  description" with mod tiers/ranges), modifier-release handling (the user is
  still holding Ctrl from Ctrl+D), polling interval and timeout.
- Only works when PoE is the foreground window, in Windowed / Borderless
  Windowed. Exclusive Fullscreen cannot show an overlay on top.
- Vaalytics will do the key simulation and clipboard read in Rust, only on the
  hotkey, and never monitor the clipboard otherwise.

## Official Trade (pathofexile.com) — _verify all_
- PoE 1: `POST /api/trade/search/{league}` → result ids; `GET /api/trade/fetch/{ids}?query={id}` (≤10 ids per call).
- PoE 2: separate `trade2` API namespace and leagues.
- Rate limits are communicated via `X-Rate-Limit-*` / `X-Rate-Limit-*-State`
  headers and must be tracked per policy; 429 responses carry `Retry-After`.
- GGG asks third-party tools to send a descriptive User-Agent with contact info.
  The contact detail must be configured by the user — never hard-coded.
- Listings include account name, last character name, online status, indexed
  time and price note; whether a price came from a stash-tab note is inferable
  from the listing's note/stash fields (_verify_).

## poe.ninja — verified 2026-11-16 (implemented in M4)
- The legacy `/api/data/currencyoverview` and `/api/data/itemoverview` endpoints
  return 404. The site now uses per-game paths:
  - `/{poe1|poe2}/api/data/index-state` — leagues (`max-age=300`).
  - `/{game}/api/economy/exchange/current/overview?league=&type=` — `{core:{primary, rates}, lines, items}`;
    PoE 1 primary = chaos, PoE 2 primary = divine (`rates.exalted`, `rates.chaos`).
    Returns 200 with empty `lines` for unknown types.
  - `/poe1/api/economy/stash/current/item/overview?league=&type=` — uniques/maps/invitations
    with `chaosValue/exaltedValue/divineValue/listingCount/links/variant`. 404 for PoE 2.
- Headers: `Cache-Control: public, max-age=1800, stale-while-revalidate=300, stale-if-error=86400`, weak ETags; 304 verified.
- Exchange icons are relative paths served by `https://web.poecdn.com`.
- robots.txt disallows only `/dev/`. No published rate limit: we serialize, space requests ≥1.5 s,
  fetch only on expiry and only categories in use.
- Community references consulted: [niko-poe PR #29](https://github.com/berkbulgan/niko-poe/pull/29) (legacy endpoint removal),
  [poe.ninja API notes](https://github.com/ayberkgezer/poe.ninja-API-Document).
