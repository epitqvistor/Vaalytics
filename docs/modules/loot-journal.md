# Loot Journal (PoE 2)

Items you copy in the game (Ctrl+C) are captured, categorised and valued automatically — captured items only, not all your loot.

| | |
|---|---|
| Registry id | `loot-journal` · group `tools` · PoE 1 not offered · PoE 2 `ready` |
| UI | `src/games/poe2/loot-journal/` (Overview, Library, Analytics, Settings, item details); **Loot Tracker overlay** window `#loot-tracker` (`TrackerWindow.tsx`); app-level `LootNotifier` + title-bar `LootCaptureIndicator` |
| Logic | Rust `src-tauri/src/loot/` (`clipboard.rs`, `item_text.rs`, `store.rs`, `valuation.rs`, `maps.rs`, `mod.rs`); TS `stats.ts` (tested) |
| Data | DataKind **user** (captures, corrections, manual maps, snapshot corrections), **estimate** (recognised inventory) and **market** (poe.ninja values with source + time). Tables `loot_items`, `loot_valuations`, `loot_capture_events` (0007), `loot_map_runs` + `loot_items` columns (0011), `loot_inventory_snapshots`, `loot_inventory_entries` (0012); files `<data dir>/loot-snapshots/*.png` (inventory crops), `<data dir>/icon-cache/poe2/*.png` (reference art); setting `loot.config` (poe2) |

## Capture pipeline

1. **Foreground gate.** The existing foreground hook (`overlay::win::watch_foreground`, event-driven)
   reports which game window is active. Only while a window titled `Path of Exile 2` (class
   `POEWindowClass`) is in the foreground *and* capture is enabled, a hidden message-only window is
   registered with `AddClipboardFormatListener`; it is removed as soon as focus leaves the game.
   No polling; outside the game Windows doesn't notify Vaalytics at all.
2. **Change notification** (`WM_CLIPBOARDUPDATE`) → the capture worker waits 80 ms to coalesce
   bursts, re-checks the gate, and reads the clipboard text once (arboard). The clipboard is never written.
3. **Recognition** (`item_text.rs`): text must start with `Item Class: `, have a `Rarity: ` line,
   name lines and be ≤ 16 KB / 400 lines. Anything else — passwords, URLs, tokens, chat — is
   dropped immediately: not stored, not logged, not sent anywhere.
4. **Header parse + category** from the item class (PoE 2 class strings as listed by the open-source
   Exile UI client table): weapons, armour, accessories, flasks/charms, jewels, socketables (runes,
   soul cores), relics, skill/support gems, stackable currency, waystones/tablets/omens/fragments (by
   class substring), uniques (unique equipment). Unknown classes → `other`, parser confidence
   `medium`, with a warning. The **raw text is always stored unchanged** and the detail view re-parses
   it with the full PoE 2 parser (`src/games/poe2/parser`, shared with the Price Checker), so parser
   improvements apply to old captures.
5. **Duplicates** (`store::capture`): fingerprint = FNV-1a hash of the normalised full text (CR/BOM
   removed, lines trimmed, `Note:` price notes ignored). Any different roll, stack size or quality →
   different item. Repeats within 3 s are always ignored (repeated notifications). Then by setting:
   **merge** (default: the existing entry's count and last-copied time go up), **cooldown** (new entry
   when the last copy is older than N minutes — intentional recapture), **always** (every copy is new).
   Identical copies of genuinely different items (two stacks of 3 Exalted Orbs) can't be told apart
   from text alone; use "always" if that matters.
6. **Session association**: active session id, area at copy time, minutes into the session, from
   Session Intelligence. **Origin** is separate and starts as `unknown`: a copy proves only that the
   item was copied (inventory, stash and trade windows copy too). The user can set
   "confirmed drop" / "not a drop".
7. **Valuation** (below) and events `loot:updated` / `loot:captured` / `loot:status`.

Each capture is one SQLite transaction; a crash can't leave half an item. Pending valuations are
picked up again by the scheduler after a restart.

## Valuation (`valuation.rs`)

Reuses the Market engine's poe.ninja cache — no second market system, no requests from the
frontend. Value is stored in Exalted Orbs (PoE 2 base unit), whole stack (`unit × stack size`).

| Item | Result |
|---|---|
| Name listed in a cached PoE 2 exchange category (currency, fragments, essences, runes, soul cores, idols, expedition, ritual/omens, breach, delirium, abyss, uncut and lineage gems) for the selected league | **Priced**, with category, league, data time and confidence (volume ≥ 100 high, ≥ 10 medium, else low) |
| Identified unique | **Priced** by name + base type from the poe.ninja PoE 2 unique categories (weapons, armours, accessories, jewels, flasks, charms, tablets); the listing matching the item's corrupted state is preferred, otherwise the other one is used with a note. Confidence from the listing count |
| Unidentified unique | **Priced by base type**: if one unique uses that base, its price (confidence at most medium); if several do (e.g. 7 uniques on Diamond), the **cheapest** — shown as "from …" — with the full range and names in the note, confidence low |
| Rare / magic / normal items | **Manual valuation required** — priced by modifiers; the detail view offers a live official-Trade search (the existing Price Checker session, user-triggered, rate-limited) and a "Set value" field |
| Waystones, relics, non-unique equipment | **Manual valuation required** — Vaalytics has no PoE 2 source for them |
| Not in the current poe.ninja snapshot, but Vaalytics recorded a poe.ninja price for it (this item, or another capture of the same non-unique base type) in the same league within 7 days | **Priced at the last listed price**: confidence low, original data time kept, note "Not in the latest poe.ninja data…", shown as "last listed" in lists. Never across leagues, never for unidentified uniques, not used when the minimum confidence is above low |
| Tradeable kind but no market row / no league / below the minimum confidence | **Insufficient market data**; retried 6 times 3 min apart, then once per revalue interval (the retry count restarts whenever the status changes) |

**League.** Prices come from the market league chosen at the top of Loot Journal (shared with
Currency Tracker). poe.ninja's snapshots differ per league — e.g. on 2026-11-17 Bear Idol and
Farrul's Rune of Grace were listed only in Forbidden Rites — so pick the league you play. When it
changes, every market-valued item is re-valued for the new league (the old values stay in the
history); prices from different leagues are never mixed. Items poe.ninja doesn't list at all
(e.g. Lavish Wombgift, checked against every PoE 2 exchange type) stay "Insufficient market data".

**Thinly traded items.** poe.ninja's exchange overview lists only items traded recently, so its
snapshot changes from hour to hour: on 2026-11-17 the Runes of Aldur essences overview had 27
essences; Perfect Essence of Alacrity, Command, Seeking and Opulence were missing, and Haste had
come back after being absent. Such items keep being rechecked (see the table) and are priced as soon
as a snapshot lists them; one that drops out keeps its last listed price for up to 7 days.

History: `loot_valuations` is append-only; a row is added only when status, quantity or value
(> 0.5 %) changes. The scheduler (one background thread) wakes every 2 minutes and on captures,
values pending items, retries missing data and revalues priced items older than the interval
(default 60 min, 0 = off). When data is missing or old it asks the Market engine
`refresh_if_expired` for at most `maxRequests` categories per pass (honours poe.ninja `max-age`). The
categories items were actually priced from are offered first (before 0.16.1 the fast-expiring currency /
fragments / essences / runes used the whole budget every pass, so e.g. delirium data aged for days).

## Settings (`loot.config`, persisted in Rust)

`enabled` (on), `duplicateMode` (merge), `cooldownMinutes` (30), `autoValue` (on),
`revalueMinutes` (60), `minConfidence` (low), `maxRequests` (4), notifications
(`notifyCaptures`, `notifyUnique`, `notifyThreshold` ex, `notifyValueChanges`, `notifyErrors` — all
off), `retentionDays` (0 = forever; favourites always kept). Capture works with Vaalytics minimised
by design (the game is the focused window), so there is no separate "while minimised" switch.
Original text is always kept (needed for re-parsing and export).

## Maps (`maps.rs`, migration 0011)

Map records connect captures to maps **without a second map tracker**:

- **auto** — a map instance Session Intelligence detected from Client.txt (session + area id + seed).
  The record follows Session Intelligence's `session:updated` event (listened to in Rust; no polling):
  entering a map instance opens its record, entering a *different* map instance or the session ending
  closes the previous one (end = its last exit). Portals back to the hideout keep it open. Its time is
  read from `play_area_visits`: time **inside** the instance (hideout time excluded). Client.txt has no
  "map completed" line, so a record is never marked completed by itself.
- **manual** — the user's own Start / Pause / Resume / Finish (`loot_map_control`), for when they prefer
  it or detection isn't available. Starting one closes an open auto record; while it is open, no auto
  records are created. Paused time isn't counted.
- **History**: on start, map instances of completed sessions recorded before 0.16 are imported once as
  finished auto records (idempotent), and captures copied inside such an instance are linked.

**Which captures belong to a map** — only when reliable: copied inside the open auto map's instance,
or while the user's manual map is running (not paused). A copy in the hideout after a map is **not**
assigned automatically (it may come from the stash or a trade); the user can assign it (Library →
Assign map, or the item's Map field), stored as `map_assignment = 'user'`. Deleting a map record keeps
its captures. Per map: duration, captures, quantity, item types, known value, unpriced count, best capture,
user strategy label / notes / "checked" flag.

## Loot Tracker overlay (`tracker_window.rs`, `TrackerWindow.tsx`)

A separate Tauri window of the same program (label `loot-tracker`, same bundle at `#loot-tracker`,
capability `capabilities/loot-tracker.json`: local content, drag/resize only — no remote URLs). Built
like the Act Tracker: frameless, transparent, **not focusable** (`WS_EX_NOACTIVATE`) so it never takes
the keyboard from the game, skip-taskbar, independent of the main window (stays while Vaalytics is
minimised). Default ~320 × 470 px at the top-right of the primary monitor; position and size are
remembered (`lootTracker.window`, implausible or off-screen bounds are ignored).

- **Header**: VAALYTICS, POE2, capture dot (green = capturing, amber = waiting for PoE 2), current area
  (from Session Intelligence), compact/expanded, collapse, hide. Collapsed = header only, with the map
  clock and value.
- **Map timer**: `MAP #NNN` (number within the session), auto / manual tag, paused marker, map name,
  clock; session time and finished maps. Start (manual) / Pause / Resume / Finish buttons.
- **Loot summary**: captured value, captures, quantity, item types, unpriced — for the open map, else the
  last map of the session, else the session.
- **Recent loot**: newest first, icon, name × quantity, value in the display currency ("≥" for an
  unidentified unique's lowest possibility; amber when low confidence, last listed or stale; "no price"
  otherwise — never a guessed number). Compact shows 5–7 rows (setting), expanded up to 40 with the area.
- **Footer**: `MAP: … | SESSION: …` from stored records.
- **Reset session** (overlay "Reset" → "Sure?", Overview strip, Settings → Loot Tracker overlay): the
  SESSION time, value, captures, maps and the recent list count from that moment (game setting
  `loot.sessionResetAt`), across game restarts; "Follow game session" goes back to Session
  Intelligence's game session. Nothing is deleted. The **Overview** then shows only that session too
  (figures, recent / most valuable captures, maps, "Session time") with "Show all history" to switch back;
  Library and Analytics always show everything.
- **Settings** (`loot.config`, shared with the main window through the `loot:config` event):
  `overlayOpacity` 0.4–1, `overlayScale` 0.8–1.4 (window width follows), `overlayMode`
  compact|expanded, `overlayCollapsed`, `overlayRows` 5–7, `overlayAlwaysOnTop`; click-through is a
  separate app setting `lootTracker.clickThrough` (the Settings tab can always turn it off).
- **Performance**: updates come from `loot:updated` / `session:updated` (coalesced 150 ms); the only
  timer is the 1-second on-screen clock, running only while the window is visible and a clock is
  counting. Hidden → the page body is unmounted.
- Opened from the Loot Journal header ("Loot Tracker"), Settings → Loot Tracker overlay, or a hotkey.

## Hotkeys (`hotkeys.rs`)

Rebindable, each optional: show/hide overlay (default **Ctrl+Shift+L**), collapse/expand, start map,
finish map (default off). Registered by `overlay::on_foreground` **only while a PoE 2 window is in the
foreground**, next to the price-check key, so they never block keys in other programs. Settings →
Hotkeys: "Set shortcut" records a key combination (physical keys; Esc cancels), shows it, then Save /
Cancel; "Default" and "Turn off". Rejected before saving: keys without Ctrl/Alt that the game needs for
typing and skills, Escape, Ctrl+C/V/X/A/Z, Alt+F4/Tab/Enter, unparsable keys, two actions on one key,
and the PoE 2 price-check key. Registration failures (key taken by another program) are shown per key
("active in game" / the reason). Changing a key re-registers immediately; the previous key is released
(`unregister_all` + register the current set). One press = one action: repeats of the same action
within 400 ms are ignored. Mouse buttons aren't supported by the global-shortcut plugin. Item capture
(Ctrl+C) is independent of all of these. Result of a press is shown in the overlay (`loot:hotkey`).

## Inventory snapshots (`inventory/`, migration 0012)

**Workflow**: open the inventory in PoE 2 → press the user's own **Inventory screenshot** shortcut (no
default; Settings → Hotkeys or the Inventory tab) → exactly one screenshot → recognition → review on the
**Inventory** tab → confirm. Also "Recognise a screenshot file…" (PNG) as a deliberate alternative.
Nothing runs in the background: no screenshot without a key press, no continuous capture or OCR.

1. **Capture** (`capture.rs`): only when PoE 2 is the foreground window; GDI copy of the game window's
   client area (not the desktop), any monitor; a black frame (exclusive fullscreen) is reported. The
   Loot Tracker overlay is hidden for ~180 ms during the capture so it can't cover the inventory. No
   memory reading, injection or input. One press = one screenshot (hotkey debounce 400 ms + a busy flag).
2. **Grid** (`grid.rs`): the inventory is anchored right and scales with window height — predicted at
   0.6013·H from the right, 0.5458·H from the top, cell 0.048756·H (calibrated on a 2560×1440 screenshot),
   then refined (±2 % position, ±3 % scale) on the grid's own pattern: dark gutter, 1 px lighter line,
   dark again. Below `MIN_SCORE` → "No open inventory was found…" and **nothing is saved**.
3. **Icons** (`icons.rs`, `refs.rs`): reference art = official images (web.poecdn.com URLs from the cached
   poe.ninja exchange data of the selected league), downloaded once, sequentially, into the icon cache
   (user consent 2026-11-24; never bundled). Cell and reference are reduced to 24×24 and compared by
   alpha-weighted colour correlation, skipping the stack-size corner (top-left) and the tier corner
   (bottom-right). Greater / Perfect variants share the base art: the **tier numeral** (II / III,
   `text::tier_strokes`) picks the variant; when it can't, the cell is at most LOW with the variants listed.
4. **Stack sizes** (`text.rs`, `digits.rs`): Windows' built-in OCR was tried and skipped most one- and
   two-digit stacks, so digits are segmented (white components of one height and top line, starting at
   the left edge) and matched to templates (8×12 + aspect) averaged from the fixture screenshot. Ink right
   after the digits (a digit fused with item art) caps the confidence. **The digit 5 has no template yet**:
   such numbers stay unread (to type in), never guessed.
5. **Confidence** per cell = min(icon, quantity): HIGH / MEDIUM / LOW / UNKNOWN (icon: score ≥ 0.72 and
   margin ≥ 0.15 → high, ≥ 0.6/0.08 → medium, ≥ 0.45 → low).
6. **Stored** (`snapshots.rs`): the inventory crop (not the whole screen), grid in crop pixels, every
   cell's recognised name / category / score / tier / quantity / alternatives, and — separately — the
   user's name, quantity, excluded and corrected flags (undo restores the recognition). Status review →
   confirmed / cancelled; "baseline" flag; map: the open map record when captured (`auto`), or the user's.
   "Retry recognition" re-runs on the stored crop and keeps corrections and exclusions.
7. **Change** (BASELINE → SNAPSHOT → CHANGE): against the latest confirmed snapshot before it (or one the
   user picks). Lines: before / after / change, **Confirmed** (both snapshots confirmed, nothing uncertain),
   **Estimated**, **Needs review** (an uncertain cell on either side). Value = change × poe.ninja unit value
   of the snapshot's league; "estimated inventory gain" sums positive, reviewed lines only. Always shown as
   an inventory change — stash transfers, spending, trades and stack splits change it too.

**Measured** (fixture, 2000×1125 downscaled WebP of a 2560×1440 screen, 60 occupied cells): grid exact
(±0.5 px); icons plausible on 51/60 by inspection, tier variants picked by numeral; stack sizes 48 / 60
correct, 9 unread, 3 wrong — all 3 flagged LOW (in-sample: the digit templates come from the same image);
whole pipeline 0.7 s (release). Result: 15 HIGH, 12 MEDIUM, 24 LOW, 9 UNKNOWN — real full-resolution
captures are sharper, but every LOW/UNKNOWN cell is put in front of the user.

**Overlay** (0.16.3): pressing the shortcut opens the Loot Tracker if it was hidden and shows an
**Inventory** block for the latest snapshot of the session (since the reset / game session / last 12 h):
known value of the recognised items, gain since the previous confirmed snapshot, cells to check, and the
items (art, quantity, value; uncertain ones amber with "?"). The overlay re-reads its data on every
`loot:updated` / `session:updated` event without timers (a background window's timers can be throttled).

**Real capture** (0.16.3, `poe2-2560x1440-capture-crop.png`): cells on a non-navy slot background
(equipment, e.g. dark red over a 2×2 helmet) are stored **excluded** as "other" and not asked about;
art is compared at scales 0.84–1.08 of the cell (Divine 0.62 → 0.73, Exalted 0.67 → 0.74); digit
templates now include that capture (the 5 from "54"); the "fused digit" check only fires for ink right
behind the number (≤ 0.45 digit width), so item art beside a number no longer caps confidence.

**Map completed** (overlay): after a map record finishes (not yet confirmed, within 15 min) the overlay
shows time, captures and value, best capture, unpriced count, the assigned snapshot's estimated change and
lines to check, and "Confirm map" (`user_confirmed`).

## Corrections and verification

Item details → **Recognition**: category and quantity can be corrected (the first recognised value is
kept in `original_category` / `original_stack_size` and shown; "Undo corrections" restores it); a
quantity change revalues the item. **Mark verified** sets `verified`. The raw copy never changes.

## UI (0.16 rework)

- **Overview**: one-line capture strip (Ctrl+C hint, last capture, the open map); a metric strip
  (captured value, items, quantity, priced, unpriced, average value per priced item, maps tracked,
  sessions); **Recent captures** (icon, name × quantity, category · area, price + source, time);
  **Most valuable captures** (40 px icons); **Recent map performance** (#, map, lvl, auto/manual, time,
  items, unpriced, captured value, best capture); recent capture errors.
- **Library**: compact toolbar (search, category, value incl. "Unpriced", sort: newest, highest value,
  quantity, category, lowest, oldest) and a **Filters** row (price min/max, dates, session, map,
  verified, favourites); 52 px rows with icon, quantity, verified / favourite / corrected markers,
  value + price source, capture time + map or area; bulk recheck, **assign map**, CSV/JSON export, delete.
- **Item details**: 52 px icon, value with source / confidence / market data time / league, **value when
  captured** next to the current one (market changes never overwrite it), history, your own value, live
  Trade check (rare/magic/unique), Recognition corrections + verified, capture time / session / area,
  map assignment, origin, status, favourite, tags, notes, parsed properties and modifiers, raw text.
- **Analytics**: metric strip (captured value, this week vs last week, average per map, value per map
  hour, average map time, maps), cumulative captured value, items per day, items per session,
  categories, **currency distribution** (stackables by value with quantity), most valuable captures,
  map table with best / lowest map, per-session reports with value/hour — always "captured items only,
  not profit".
- Price source labels: `poe.ninja · high|medium|low`, `last listed · low`, `lowest possible`
  (unidentified unique), `your value`. Item art comes from market data (poe.ninja / official CDN URL)
  when the item is listed there, otherwise a category glyph (never another item's picture).

## IPC

`loot_status`, `loot_config`, `loot_set_config`, `loot_list(query)`, `loot_detail(id)`,
`loot_edit(id, edit)`, `loot_revalue(ids)`, `loot_set_manual_value(id, value|null)`,
`loot_delete(ids)`, `loot_clear`, `loot_events`, `loot_export(ids, json|csv)`, `loot_import`
(JSON, every item re-validated as item text), `loot_maps(sessionId?, limit)`, `loot_map_counts`,
`loot_map_control(start|pause|resume|finish, id?, name?)`, `loot_map_edit(id, strategy?, notes?, confirmed?)`,
`loot_map_delete(id)`, `loot_assign_map(itemIds, mapId|null)`, `loot_tracker_summary(recent)`,
`loot_tracker_state`, `loot_tracker_window(open|hide|toggle|close)`, `loot_tracker_set_click_through(on)`,
`loot_hotkey_problem(key)`, `loot_inventory_snapshots(limit)`, `loot_inventory_detail(id, against?)`
(snapshot, entries, crop as data URL, grid, change), `loot_inventory_edit_entry(entryId, edit)`,
`loot_inventory_update(id, status?, baseline?, mapId?, clearMap?)`, `loot_inventory_reprocess(id)`,
`loot_inventory_delete(id)`, `loot_inventory_from_file`, `loot_inventory_item_names`. Event
`loot:inventory` (working / captured / error). Events: `loot:config`, `loot:hotkey`, `loot-tracker:state`,
`loot-tracker:collapse`; `overlay_status` lists the registered loot keys. `loot_list` also returns the latest
valuation's source / confidence / data time / league, the value at capture, map, verified and
corrections; query adds `unpricedOnly`, `verifiedOnly`, `mapRunId`, sort `quantity`. `loot_edit` adds
`verified`, `category`, `stackSize`, `resetCorrections`. All require `game = poe2` and run off the UI thread.

## Supported item text

Verified structure: `Item Class:` / `Rarity:` / name lines / `--------` sections, `Stack Size: a/b`
(thousands separators accepted), `Item Level:`, `Quality: +N%`, `Corrupted`, `Unidentified`,
`Mirrored`, and the full-parser markers used by the Price Checker (`(implicit)`, `(rune)`,
`(desecrated)`, advanced-copy mod headers…).

## Limitations

- Test samples follow the PoE 2 copy format used by the Price Checker fixtures; they are not yet
  in-game captures from this machine (no PoE 2 session was available while building). Replace them
  in `item_text.rs` (`samples`) and `parser.test.ts` when real copies are at hand.
- English client only (class/rarity strings).
- Copying ≠ looting: the journal can't know what you picked up without copying it, and never claims to.
- Inventory recognition was calibrated on one 16:9 screenshot (2560×1440); other aspect ratios and UI
  scales rely on the ±2–3 % search and are unverified. Multi-cell items are not merged (each cell is a
  row; non-currency cells are usually UNKNOWN — exclude them). Items without poe.ninja art (e.g. some
  splinters) can't be recognised by picture — pick the name. Digit 5 has no template yet. Exclusive
  fullscreen can't be captured. Instant Buyout: no supported API (the Trade site refuses automated
  requests) — the Trade search stays a manual check.
- Rares and other non-unique equipment are not priced automatically (no reliable PoE 2 source).
- Items poe.ninja hasn't listed in the selected league since Vaalytics started recording have no
  value until it lists them (thin trading; it isn't a parser problem). Enter your own value if needed.
- Unique prices are poe.ninja's listing-based values; rare corrupted variants can be thin or outliers
  (check the listing count). An unidentified unique is valued at the cheapest possibility, never the
  most expensive.
- Identical copies of different items merge by default (see duplicates).
- Future sources (OCR, screenshots) can add rows with another `source` value; drop attribution would
  set `origin_status` only from a verified source. No memory reading, injection or packets — ever.

## Tests

Rust (`cargo test loot`): recognition and categories, rejection of passwords/URLs/tokens/oversized
text, unknown classes and missing fields, fingerprints (line endings, notes, rolls, stacks), stack
sizes with separators, duplicate modes (debounce, merge, cooldown recapture, always), valuation from
cached data (stacks, categories, no invented prices for rares/uniques, missing league/data, minimum
confidence, game isolation), append-only history, scheduler retry → priced, items dropping out of a
snapshot (last listed price kept ≤ 7 days, same league only, minimum confidence, relisted → repriced),
no-data items rechecked at the interval after the fast retries, map records (follows Session
Intelligence, portals keep a map open, a new instance / session end closes it, hideout time excluded,
manual start / pause / resume / finish, manual suspends auto, capture assignment only when reliable,
backfill idempotent, user assignment, strategy / notes / confirmed, deleting keeps captures, game
isolation), corrections (kept originals, undo, validation, raw text unchanged), verified / unpriced
filters, quantity sort, value at capture vs current, inventory recognition on the real screenshot fixture (grid position, no grid on the game world /
flat frames, black-frame detection, PNG round trip, CDN-only art per league, tier variants), snapshots
(baseline → snapshot change with review states, corrections kept with the original, cancelled snapshots
never compared, re-recognition keeps corrections, cascade delete, game isolation), base64; ignored
manual-QA tests run icon matching / digits / the full pipeline on the fixture with downloaded art;
hotkeys (typing keys / Escape / Ctrl+C / Alt+F4
refused, F8 / Shift+F8 / Ctrl+Shift+S / Ctrl+Alt+I accepted, clashes between actions and with the
price-check key, defaults), session link and
`ON DELETE SET NULL`, search by modifier/name/base with LIKE escaping, filters, edits that never
touch raw text, retention keeping favourites, export/import round trip with re-validation, CSV,
config persistence/sanitising, privacy (nothing but the item stored or logged).
Frontend (`stats.test.ts`): totals with unpriced items, quantity and average, categories, per-session rates, daily buckets, currency distribution, week comparison, map stats (short and open maps skipped), running map clock; `ui.test.ts`: price source labels
(stale after 24 h, last listed, lowest possible, your value), clock formats, hotkey recording from key events.
