# Deck Intelligence

Track your Stacked Deck openings from Client.txt and ground screenshots, with a permanent history, valuations and statistics.

| | |
|---|---|
| Registry id | `deck-intelligence` · group `economy` · PoE 1 `ready` · PoE 2 not offered (no divination cards) |
| UI | `src/games/poe1/deck-intelligence/` (Session · Statistics · History · Collection · Settings), `DeckNotifier.tsx` mounted in `App.tsx` |
| Logic | `analytics.ts` (pure, tested), `prefs.ts`; Rust `src-tauri/src/decks/` |
| Data | Market Data `divination` + `currency` (poe.ninja via `MarketEngine`), RePoE `base_items` (card list), the user's sessions (SQLite, migration 0013). Kinds: market, historical (original valuation), estimate, user, game-data |
| Patch rules | none — nothing patch-dependent |

## Tracking — two optional sources

### Client.txt (verified)
PoE 1 writes one system line per Stacked Deck card:

```
2026/11/25 15:04:02 10325187 cffb06be [INFO Client 12060] : Card drawn from the deck: <divination>{The Lover}
```

Verified on a real log (2026-11-26: 400+ such lines between 2025-11 and 2026-11, one burst of ~350 cards on one
day). **Cards dropped on the ground are not logged** (verified 2026-11-26: the user opened decks onto the ground in
Kingsmarch at ~03:13 — 25 cards visible on screen — and the log has normal lines around it but no
"Card drawn from the deck" line that day). So the line comes from opening into the inventory; ground openings
need the screenshot path, and with both on there is no overlap for ground drops.

- `decks/logparse.rs` accepts only system messages (`] : `); chat lines (sender / channel prefix) can't add cards.
- Reading reuses the shared incremental reader (`session::reader`: complete lines only, truncation / replacement
  detection) and the PoE 1 log the Location Atlas uses (`campaign::resolve_poe1_log` → chosen path or Steam/
  standalone discovery). No second watcher: a `deck-log` thread reads new bytes every 2 s **only while a session is
  running** with Client.txt tracking on; otherwise it sleeps on a condition variable (no polling while idle).
- A session starts at the end of the file (old lines aren't this session's); resume after a pause jumps to the end
  (lines written while paused don't count). After a restart a *running* session continues from its stored offset,
  so cards drawn while Vaalytics was closed are picked up.
- Every line has a stable id `log:<file key>:<byte offset>` (unique index): the same line is never stored twice —
  live, again after a restart, or via a later import.
- Nothing else from the log is stored.

### Ground screenshots (Windows OCR)
1. The user's own shortcut (Settings → Tracking; none by default) is registered by `overlay::on_foreground`
   **only while PoE 1 is the foreground window**, next to the price-check key. One press = one screenshot
   (400 ms debounce + a busy flag; a press while one is being read is reported, not queued).
2. Capture: `loot::inventory::capture::game_window_of(Poe1)` — GDI copy of the game window's client area (not the
   desktop), then the configured region (fractions of the window: whole window, centre, without HUD, custom).
   No memory reading, injection or input. Exclusive fullscreen comes back black and is reported.
3. OCR: **Windows.Media.Ocr** (built into Windows 10/11, local; English engine if installed, else the profile
   language). Loot filters style card labels very differently, so the image is read **twice** with two grey
   conversions (recogniser v2): inverted brightest channel (light text on dark boxes, dark text on blue boxes) and
   luminance (coloured text on white boxes — e.g. blue on white, where the brightest channel makes text and box
   equally bright). Upscaled ×2 for small regions, kept within the engine's max dimension. Reads of the same label from
   both passes are merged (overlapping boxes → the better read). ~1.1 s per screenshot (2000×1070).
   A **stack prefix** ("3x Divine Beauty") becomes that many entries of the card, each with its own duplicate check.
4. Recognition (`recognize.rs`, `matching.rs`): OCR lines are split at wide gaps (labels side by side), each piece
   matched against the card names (RePoE list + poe.ninja names for the league): normalised text (case, apostrophes,
   punctuation), Levenshtein similarity, short names penalised; runs of touching labels are segmented into
   consecutive names. Overlapping reads of the same label are merged; copies at other spots are kept.
5. **Confidence** = similarity 0–1. With the user's thresholds (defaults): ≥ 90 % and unambiguous (runner-up card
   ≥ 8 points lower) → **Confirmed**; ≥ 70 % → **Needs review**; ≥ 60 % → **Unrecognized** (shown with a suggestion, no
   card); lower → other ground text, ignored and only counted. Item labels use a small-caps font that OCR returns in
   capitals; mixed-case text that would only be "unrecognized" (UI, NPC names, the area panel) is ignored instead. (The unrecognized default was 50 %; on the real
   screenshot below, three UI texts scored exactly 0.50 against card names, so it was raised to 60 %.)
6. **Duplicates** (never dropped silently): within the duplicate window (default 90 s), a card at the same spot
   (centre within 2 % of the capture size, same capture size) as an entry of an earlier screenshot → Needs review
   "possibly the same label"; a card that Client.txt also recorded in the window → Needs review "also recorded from
   Client.txt" (and a log line arriving after a screenshot flags that screenshot entry). The review queue offers
   "Remove N likely duplicates".
7. Stored: the capture (PNG of the region in `<data dir>/deck-captures`, local only, optional), every entry with the
   OCR text, best match, confidence, box, status and the user's correction (`corrected`). **Retry** re-reads a kept
   screenshot and keeps corrected entries.
8. Also: "Recognise a screenshot file…" (PNG) runs the same pipeline.

**Validation (real screenshot, 2026-11-26)**: `tests/fixtures/decks/ground-2000x1070-filter-blue.webp` — the user's
own Kingsmarch screenshot (2000×1070, a loot filter with dark text on blue label boxes, small caps), 25 cards on the
ground incl. copies (Emperor's Luck ×3, Three Faces in the Dark ×2, The Wolf ×2, Chaotic Disposition ×2), two labels
touching in one row, one label partly covered by a life bar, one cut off at the left, plus Exalted / Chaos Orb, NPC
names and quest text. Result (default thresholds, whole window): **25 detections = the 25 cards, no wrong card, no
false entry**; 23 confirmed, 2 to review with the right suggestion ("SCHOLAR OF THE SE" → Scholar of the Seas 0.89,
"HE FORTUNAT" → The Fortunate 0.85); currency, NPC and UI text ignored; OCR 0.55 s. Run it with
`DECK_CARDS_JSON=<data dir>/decks/cards.json cargo test --lib real_ground_screenshot -- --ignored --nocapture`.
One screenshot is not a benchmark: other filters (light text on dark), 4K / UI scaling, dense overlapping piles
and labels hidden behind others are untested; labels that aren't visible can't be read — every uncertain read
goes to review. A synthetic image (serif font, light text on dark) also read perfectly.

Second real screenshot (`ground-2000x1070-filter-white.webp`, a filter with blue text on white boxes for valuable
cards): recogniser v1 found 1 of 2 labels (the white boxes had no contrast); v2: "Lonely Warrior" confirmed, "3x Divine
Beauty" → Divine Beauty ×3 to review (the mouse pointer covers the end of the label). The first screenshot still gives
25/25 with v2 (24 confirmed, 1 review, no false entries; "The Fortunate" now confirmed by the luminance pass).

## Sessions
- One unfinished session at a time: running ⇄ paused → finished (read-only). Saved as you go; survives restarts.
- Fields: name (default format `Stacked Decks · {date}`), league, opening date, number of decks, acquisition
  (individually / bulk / farmed / free / unknown), total cost (chaos; "Market price" = decks × poe.ninja Stacked Deck
  price, labelled), notes. All but the name optional; editable later (also for finished sessions).
- One Stacked Deck = one card. **Decks opened** is the user's own count (editable in the session's "Decks opened" tile
  and in the form; migration 0015 `opened_decks`) — ground openings aren't in Client.txt and a screenshot can miss
  labels. Without it: confirmed cards (finished sessions with a "decks bought" count: max(bought, cards)). Never fewer
  than the confirmed cards.
- **Decks bought** (form; stored as `planned_decks`) is what the cost is for. Cost per deck = cost / bought; the cost
  used for profit and ROI is the share of the decks opened: total × opened / bought (capped at the total), so decks
  not opened yet aren't counted as a loss (before 0.22 a fresh session with 2,472 bought decks showed −100 %).
  Without a bought count the whole cost is used.
- **Finish** freezes the session's valuation (`deck_valuations`, kind `final`, never overwritten): per card qty, unit
  price and its source (market / manual / unknown), poe.ninja fetch time, league. History shows both that original
  value and today's value.
- Entries: confirm, correct (card picker; only known card names), remove, restore, add manually (× quantity). Not
  possible once finished.
- **Card quantity** (session report, Qty column, also for finished sessions): the user's count for a card, e.g. after
  pressing the screenshot key twice. Fewer: the newest confirmed entries become `removed` with "Quantity corrected by
  you" (kept, `corrected`); more: manual entries. A finished session is revalued with the unit price each card was
  valued at (cards new to it take today's price); `valued_at` stays. The backup file is rewritten.
- Delete: permanent, with confirmation; removes the session, its entries and kept screenshots.
- Export: sessions list → CSV, one session → JSON (save dialog).
- History shows the **selected league** (the page's league picker) with its totals (sessions, decks, value, cost,
  profit, ROI). Every other league — and sessions without a league — is behind **"Previous leagues · N"** at the
  bottom: a window with one collapsible section per league (newest first, "No league" last; `groupByLeague`), compact
  rows, totals in each header; clicking a session closes the window and opens it. Search, filters and sort apply to
  both.
- A session with cards but no price for any of them (e.g. a league poe.ninja doesn't cover) shows "no prices":
  value unknown, no profit, no ROI — never 0 c / −100 %.

## Backups (`decks/backup.rs`, 0.23)
On 2026-11-26 the user's database was lost (uninstall with "delete app data" removes
`%APPDATA%pp.vaalytics.desktop`). Since then every session is also a JSON file **outside** the app data folder —
default `Documents\Vaalytics\Deck Intelligence` (`Settings → Backups`, `decks.config.backupDir`; on by default):
- `deck-session-<date>-<created_at>-<id>.json` with every column of the session, its card entries (incl.
  `source_uid`, corrections, OCR text) and its original valuation; rewritten after every change (create, edit, decks
  opened, pause/resume/finish, each card from Client.txt or a screenshot, review actions, manual cards, imports) via a
  temporary file + rename. All sessions are written once at startup. Screenshots aren't included.
- Deleting a session moves its file to `deleted\` (never removed by Vaalytics).
- **Restore from backups** reads the folder (not `deleted\`): a session counts as already present when creation and
  start time match AND it shares a card entry (`source_uid`) — or, without cards, the name — so renamed sessions and
  sessions created in the same second are handled; card ids keep restoring idempotent. A restored unfinished session
  is paused (finished if another one is open). Unreadable files are listed, never fatal.
- Dev builds with `VAALYTICS_DATA_DIR` write backups into `<data dir>\deck-backups`, never into Documents.
- Verified in the app: 6 sessions backed up → a fresh empty database → "Restore from backups" → 6 sessions, 75 cards,
  original valuations intact; restoring again adds nothing.

## Import (Client.txt)
Settings → Import: pick a Client.txt (must look like a PoE 1 log), worker thread with progress events and cancel
(nothing is written until the file has been read). Cards are grouped into finished sessions named
`Imported · YYYY-MM-DD`, split where no card was drawn for N minutes (default 60, 0 = one session). Lines already
stored are skipped (same ids as live tracking). Timestamps are the log's. The valuation uses the **chosen league's
prices at import time** (labelled; old leagues' prices aren't available). Ground drops that never reached the log
can't be recovered.

## Calculations (`analytics.ts`)
- Card value = Σ confirmed cards × unit price; unit = manual price (league) → poe.ninja → **unknown** (counted as
  unpriced, never 0).
- Session value = original valuation when finished, live estimate otherwise.
- Profit = value − cost of the decks opened (see Sessions); **ROI = profit / that cost × 100**, only when it is known
  and > 0. Profit follows "Prices in" like every other amount. Outcome: profitable /
  unprofitable / break-even (±1 % of cost, min 1 c) / no cost.
- Totals: profit and ROI over sessions with a known cost only (the count is shown); value per deck, cost per deck,
  average card, average session ROI, best / worst session, unique vs duplicate cards, cards above the top range,
  share of value from the top 3 cards, value per minute (live sessions' running time).
- Review / unrecognized entries are never in any total.

## Statistics
Filters (all charts follow them): league (default: selected league or all — setting), 7 / 30 / 90 days / all time /
dates, acquisition, one session. KPIs + charts (own SVG, `charts.tsx`, tokens only, hover + keyboard tooltips,
click → session): profit/loss over time (cumulative or per session with running-total line, zero line), session value
(sort by date / value / profit / decks), ROI per session, card value distribution (ranges from Settings; unpriced
listed apart), session outcomes, decks opened per day / week / month, most valuable drops, most frequent cards
("observed in your sessions — not drop rates"). Empty history → an explanation, no sample data.

## Collection
Cards obtained across sessions (not the game's list): quantity, reward + stack size (RePoE), average unit, total value,
sessions, last obtained; a card opens its acquisition history (which sessions, value each).

## Notifications (`DeckNotifier`, all configurable)
Card ≥ N c (default 100 c), screenshot entries to review / failed screenshot, profit milestone (once per session,
cost known), "Session finished" on finish. At most one toast per 2 s.

## Data integrity
- Card list: RePoE `base_items.min.json` (game files), ETag, re-checked at most daily, cached in `<data dir>/decks`.
- Prices: only the Market Data engine (poe.ninja, its own cache / rate limits); no request from the frontend.
- Artwork: the official Divination Card icon (web.poecdn.com) for every card — RePoE has no per-card art file names
  and no verified per-card art source was found (checked 2026-11-26).
- No drop rates, no simulator (no reliable data source for weights in this module).
- Screenshots, logs and sessions stay local; nothing is uploaded.

## Storage (migration `0013_decks`, additive)
`deck_sessions`, `deck_captures`, `deck_events` (unique `(game, source_uid)`), `deck_valuations` (one `final` per
session), `deck_price_overrides`. All `game = 'poe1'` (CHECK). Multi-row writes run in transactions.

## Tests
- Rust (`cargo test --lib decks`): log line parsing incl. chat spoofing; matching (normalisation, noise, short names,
  ambiguity, thresholds); recognition (several cards, copies, touching labels, other items, empty, double reads,
  same-spot); store (lifecycle, pause/resume time, duplicates, read-only after finish, valuation never 0 for unknown,
  imports skipping stored lines, overrides); service (log lines → events once, import after live tracking,
  corrections). Ignored: `live_repoe_cards` (network), `ocr_image_from_env` (`DECK_OCR_IMAGE=<png>`, real OCR).
- Vitest (`analytics.test.ts`): profit / ROI / unknown cost / zero cost, live vs original valuation, unpriced cards,
  planned decks, totals, filters, cumulative, volume, card rows, top drops, distribution, CSV.

## Not yet / limitations
- Ground recognition validated on one real screenshot only (see above). Ground drops are not in Client.txt.
- Mouse buttons can't be used as the shortcut (global-shortcut plugin).
- No per-card artwork, no drop-rate simulator.
- The live-session duration counts from the session start, not from the first card.
