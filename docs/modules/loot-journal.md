# Loot Journal (PoE 2)

Items you copy in the game (Ctrl+C) are captured, categorised and valued automatically — captured items only, not all your loot.

| | |
|---|---|
| Registry id | `loot-journal` · group `tools` · PoE 1 not offered · PoE 2 `ready` |
| UI | `src/games/poe2/loot-journal/` (Overview, Library, Analytics, Settings, item details); app-level `LootNotifier` + title-bar `LootCaptureIndicator` |
| Logic | Rust `src-tauri/src/loot/` (`clipboard.rs`, `item_text.rs`, `store.rs`, `valuation.rs`, `mod.rs`); TS `stats.ts` (tested) |
| Data | DataKind **user** (captures) and **market** (poe.ninja values with source + time). Tables `loot_items`, `loot_valuations`, `loot_capture_events` (migration 0007); setting `loot.config` (poe2) |

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
`refresh_if_expired` for at most `maxRequests` categories per pass (honours poe.ninja `max-age`).

## Settings (`loot.config`, persisted in Rust)

`enabled` (on), `duplicateMode` (merge), `cooldownMinutes` (30), `autoValue` (on),
`revalueMinutes` (60), `minConfidence` (low), `maxRequests` (4), notifications
(`notifyCaptures`, `notifyUnique`, `notifyThreshold` ex, `notifyValueChanges`, `notifyErrors` — all
off), `retentionDays` (0 = forever; favourites always kept). Capture works with Vaalytics minimised
by design (the game is the focused window), so there is no separate "while minimised" switch.
Original text is always kept (needed for re-parsing and export).

## UI

- **Overview**: capture state, totals (today / this week), captured value with the "captured only"
  note, unpriced count, top category, latest captures, most valuable capture, recent capture errors.
- **Library**: search name / base type / modifier text, filters (category, rarity, value status, min
  value, session, date range, favourites), sorts (newest, oldest, value ↑↓, category), selection with
  recheck / export / delete; virtualised rows.
- **Item details**: identity, value + history, recheck, your own value, live Trade check (rare/magic/
  unique), capture time and session/area, origin, status (captured / kept / sold / discarded),
  favourite, tags, notes, parsed properties and modifiers, parser notes, original text + Copy, delete.
- **Analytics**: captures and value per day, categories, most valuable, per-session reports (items,
  value, unpriced, most valuable; captures/hour and value/hour during tracked sessions), always with
  the warning that this is captured items only — no profit is computed.

## IPC

`loot_status`, `loot_config`, `loot_set_config`, `loot_list(query)`, `loot_detail(id)`,
`loot_edit(id, edit)`, `loot_revalue(ids)`, `loot_set_manual_value(id, value|null)`,
`loot_delete(ids)`, `loot_clear`, `loot_events`, `loot_export(ids, json|csv)`, `loot_import`
(JSON, every item re-validated as item text). All require `game = poe2` and run off the UI thread.

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
no-data items rechecked at the interval after the fast retries, session link and
`ON DELETE SET NULL`, search by modifier/name/base with LIKE escaping, filters, edits that never
touch raw text, retention keeping favourites, export/import round trip with re-validation, CSV,
config persistence/sanitising, privacy (nothing but the item stored or logged).
Frontend (`stats.test.ts`): totals with unpriced items, categories, per-session rates, daily buckets.
