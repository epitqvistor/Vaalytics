# Price checker

Flow: **hotkey → copy → parse → filters → official Trade search → listings + estimate**, in the overlay or on the Price Checker page (paste mode).

## 1. Hotkey and item capture (`src-tauri/src/overlay`)
Behaviour modelled on Awakened PoE Trade's documented flow (studied, not copied):

- A foreground-change hook (`SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`, event-driven, no polling) detects the game window by class `POEWindowClass` **and** exact title (`Path of Exile` / `Path of Exile 2`).
- The price-check shortcut (per game, default **Ctrl+D**, alternatives in Settings) is registered with `RegisterHotKey` **only while the game is focused**. Ctrl+D therefore keeps working normally in browsers and other apps.
- On press: remember the clipboard text (clear it if it already holds item text) → send the game's own copy shortcut (Ctrl is only pressed if the user isn't already holding it; since PoE 3.29 Ctrl+C copies the advanced format) → poll the clipboard every 40 ms for up to 600 ms for text starting with `Item Class:` → restore the previous text (Settings → *Restore clipboard*, default on).
- The price check never monitors the clipboard. (Loot Journal, PoE 2, listens for clipboard changes only while the PoE 2 window is focused — see loot-journal.md; a price-checked item is captured there too, as it is an item copy.) No memory reading, injection or game-file access.

## 2. Parsing (`src/shared/item-parser`, `src/games/<id>/parser`)
Shared engine + per-game rules (markers, flags, special sections):

| | PoE 1 | PoE 2 |
|---|---|---|
| Line markers | `(implicit)` `(crafted)` `(fractured)` `(enchant)` `(scourge)` | `(implicit)` `(enchant)` `(rune)` `(added rune)` `(desecrated)` `(crafted)` `(fractured)` |
| Requirements | multi-line `Requirements:` block | single `Requires: Level 52, 40 Int` |
| Sockets | links computed (`R-R-G B` → 3) | rune sockets, no links |
| Flags | influences, Synthesised, Fractured, Foulborn, Corrupted, Mirrored… | Corrupted, Twice Corrupted, Unmodifiable, Sanctified… |

Advanced headers `{ Prefix Modifier "Name" (Tier: N) — tags }` give kind, prefix/suffix, tier, name and tags; roll ranges `+68(60-69)` are split from display values. Lines like cluster jewels' `Added Small Passive Skills also grant: …` are modifiers even though they contain a colon (not `name: value` properties). Flavour/help text goes to `description`; unknown lines go to `unparsed` and are shown as a warning — never silently dropped.

## 3. Stat matching and filters (`src/shared/trade`)
- Stat templates come from `/api/trade/data/stats` (PoE 1, ~18.4k) and `/api/trade2/data/stats` (PoE 2, ~8.2k), downloaded by the host and cached on disk for 24 h.
- Lines and templates are normalized (numbers → `#`, sign before `#` dropped — PoE 1 uses `+#`, PoE 2 `#`). `reduced/increased`, `less/more` are inverted with a negated value. `Adds # to #` uses the average.
- Pseudo totals (resistances, life; PoE 1 adds Strength/2 to life) are offered only when the game's stat data has that pseudo id.
- **Default selection** (modifiers are not equally valuable): pseudo elemental-resistance / chaos-resistance / life totals and tier ≤ 2 explicit or fractured mods. Mods already covered by an enabled pseudo total, implicits, crafted, enchant and rune mods start disabled; totals made only of crafted mods start disabled. Uniques, gems, currency and cards search by name/base only. Every filter has editable min/max.
- **Suggested minimums are whole numbers:** 90 % of the roll, floored, for rolls ≥ 10; smaller rolls keep their own floored value (1.4 → 1). Rolls below 1 (e.g. 0.4 % leech) stay as they are.
- **Option stats.** Trade lists some stats per option as `id|option` (cluster jewel "Added Small Passive Skills grant: …", `enchant.stat_3948993189|42`). They are sent as `{ id, value: { option } }` and shown as *exact match* without min/max — a `min` on them makes Trade return 0 results (verified live, Nov 2026).
- **Corpses (PoE 1, `Item Class: Corpses`, rarity Currency):** searched by base type (e.g. `Perfect Serpent Warrior`). Their lines are the monster's fixed abilities — defined by the base, not searchable on Trade — so they are neither filters nor reported as unmatched.
- The automatic search runs once the filters for the item are built, even when the item has no searchable stats (before, an item whose every line was unmatched never searched).
- **Cluster jewels (PoE 1):** their enchants (passive count, jewel sockets, passive type) start enabled and match exactly (count min = max). Magic cluster jewels are searched by the base found in their name (`Small|Medium|Large Cluster Jewel`).

## 4. Trade API (`src-tauri/src/trade`)
- Search `POST /api/trade/search/{league}` (PoE 2: `/api/trade2/search/poe2/{league}`), fetch ≤10 ids per `GET …/fetch/{ids}?query={id}` (PoE 2 adds `&realm=poe2`). No session cookie is used.
- **Identification:** requests carry `User-Agent: Vaalytics/<ver> (Windows desktop companion; contact: <your contact>)`. Without a contact, live searches are disabled (contact gate in the UI).
- **Rate limits:** the client tracks every policy the server announces (`X-Rate-Limit-Policy/Rules/<rule>/<rule>-State`), keeps a one-request safety margin, honours active penalties and `Retry-After`, and reports waits longer than 10 s instead of queuing (`MAX_INLINE_WAIT`).
- Listings are normalized: price/currency/type, account, last character, online/AFK/offline, indexed time, item note vs stash-tab price, whisper, item mods. Prices are converted to the base unit with cached poe.ninja rates (Currency category of the same league); unconvertible prices stay in their own currency and are excluded from the estimate.

## 5. Estimate (`estimate.ts`)
Labelled **Estimate**, separate from listings. Uses converted prices of fetched listings; ignores listings below 35 % of the median (bait/mistakes) when ≥4 listings; estimate = median of the 5 cheapest kept. Confidence: high (≥8 kept, p75/p25 ≤ 2), medium (≥4, ≤ 4), otherwise low.

## 6. Overlay window
Created on first use (no idle cost). Transparent, frameless, always on top, not in the taskbar. Drag by header, resize from edges; position/size saved (`overlay.bounds`). Esc or × hides it.

**Pressing the price-check hotkey again closes it** (toggle):
- Overlay focused (the usual case right after it opens): the game isn't in the foreground, so the global hotkey is unregistered; the overlay window catches the game's configured shortcut itself (`matchesShortcut`, `src/shared/utilities/shortcut.ts`) and hides.
- Game focused again with the overlay open: the hotkey copies as usual; if the copied item is the one already shown, or nothing was copied, the overlay hides (`closes_overlay` in `overlay/mod.rs`). A different item is price-checked instead, so checking the next item still takes one press. Click-through toggle passes clicks to the game until the hotkey opens the overlay again. Opacity per game. *Settings → Preview overlay* opens it without the game for positioning.

## Limitations
- **Exclusive Fullscreen:** no window can draw over it — use Windowed or Borderless Windowed.
- **Game running as administrator:** Windows blocks simulated input from a non-elevated app; run Vaalytics elevated too (the overlay explains this when the copy fails).
- English client only.
- Magic items: base type can't be isolated from affixed names without base-type data, so they are searched by modifiers and rarity only (exception: cluster jewels).
- Not yet verified against a running game in this environment (no game available): hotkey registration, copy simulation and clipboard read. Parser fixtures for the advanced format are constructed from documented markers; replace with real captures.
- Live Trade search not exercised by Vaalytics itself yet (no contact configured). Opt-in test: `set VAALYTICS_TRADE_CONTACT=…` then `cargo test --manifest-path src-tauri/Cargo.toml live_trade -- --ignored --nocapture`.

## Gems

- Transfigured gems ("Static Strike of Gathering Lightning") are searched as base gem + discriminator
  (`type: { option: "Static Strike", discriminator: "alt_x" }`). The list comes from the official
  `/api/trade/data/items` (gem group, entries with `disc`), cached on disk for 24 h like the stat list
  (`trade_gem_variants`). Without the list the plain name is sent.
- Gem level comes from the gem's own `Level:` line; the `Requirements:` block (character level, Str, Dex, Int)
  is parsed separately so it never overrides it.
- Gem filters (editable): level min–max and quality min–max (default: the gem's own values; empty = no
  limit) and corruption (Any / Corrupted / Not corrupted; gems default to their own state).

## Listing status (3.30 instant buyout)

PoE 1 Trade has instant-buyout listings whose sellers needn't be online. The search status is a
choice: **Instant buyout + online** (`available`, the Trade site's default and ours for PoE 1),
Instant buyout only (`securable`), Online sellers only (`online`), Any. PoE 2 offers Online / Any
(no instant-buyout listings there, checked 2026-11-17). Instant-buyout listings (fetch result has a
gold `fee`) are marked "Instant buyout" instead of "Offline" and are never hidden as offline.
Before 0.9.2 the search used `online`, which left out instant-buyout listings (e.g. 2 instead of 104).
