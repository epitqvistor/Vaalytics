# Price checker

Flow: **hotkey → copy → parse → filters → official Trade search → listings + estimate**, in the overlay or on the Price Checker page (paste mode).

## 1. Hotkey and item capture (`src-tauri/src/overlay`)
Behaviour modelled on Awakened PoE Trade's documented flow (studied, not copied):

- A foreground-change hook (`SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`, event-driven, no polling) detects the game window by class `POEWindowClass` **and** exact title (`Path of Exile` / `Path of Exile 2`).
- The price-check shortcut (per game, default **Ctrl+D**, alternatives in Settings) is registered with `RegisterHotKey` **only while the game is focused**. Ctrl+D therefore keeps working normally in browsers and other apps.
- The same registration routine also handles the Act Tracker, Deck Intelligence, Loot Tracker and show/hide-Vaalytics keys (docs/architecture/overview.md → Global hotkeys, docs/modules/main-window-hotkey.md).
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

- **Refused by the site's protection.** On 2026-11-20 every search `POST` (PoE 1 and PoE 2) got `405 Not Allowed` as an HTML page from Cloudflare/openresty, while `GET` data endpoints still worked and the Trade page showed a "Just a moment…" challenge. An HTML 403/405/503 with those markers is reported as "The Trade site is refusing automated searches right now …" (`error_message` in `trade/mod.rs`) instead of a bare "HTTP 405"; Vaalytics never tries to get around it. The error box offers **Open this search on the Trade site** (`tradeSiteSearchUrl`: `/trade/search/<league>?q=<query JSON>`), so the user can run the same search in a browser.

## 5. Valuation (`valuation.ts`, rework 2026-11-25)
The old estimate (median of the 5 cheapest of the 10 cheapest listings, "high" whenever ≥8 were within ×2) made
unsupported claims: a rare searched by base type only could show "High confidence". It was replaced:

- **Sample.** Trade sorts by price, so a search fetches the **20 cheapest** of `total` matches. Every number is
  "what comparable items are listed for at the cheap end" — the UI says which sample it used.
- **Verdict per listing** (shown on the row, never silently dropped): `used`, `low-outlier` ("cheap"), `high-outlier`
  ("pricey"), `no-price` (currency not convertible with poe.ninja rates).
- **Outliers.** ≥5 prices: Tukey fences (1.5 × IQR) on **log** prices (prices are multiplicative), with a floor on
  the spread and a rounding guard — an outlier must also be > 1 base unit outside the cluster (1 c among 2–3 c is a
  price; 1 alch is bait). 3–4 prices: below 35 % / above 3× the median. Fewer: no outliers.
- **Estimate** = median of the used listings, weighted by how well each matches the searched modifiers
  (weight 0.5 + 0.5 × match). Lowest, median and the typical range (p25–p75) are shown separately — they are
  different things.
- **Search basis** (`searchBasis` in `query.ts`): `exact` (unique/gem/currency/card/corpse/white base — identity),
  `stats` (modifiers searched), `base` (a rare/magic searched without modifiers).
- **Confidence:** `unpriced` (no matches / nothing convertible), `base-only` (basis `base` — the number is shown
  greyed with "Base type only — the estimate may not reflect this item's modifiers"; never graded), `insufficient`
  (< 3 usable prices — no estimate at all), otherwise high (≥ 8 used, p75/p25 ≤ 1.6) / medium (≥ 5, ≤ 3) / low,
  capped at medium by: > 30 % outliers, average match < 80 %, unsearchable modifiers, median listing age > 7 days;
  capped at low when fewer than 5 listings exist. The reasons are listed under the confidence badge.
- **Live check:** `VAALYTICS_LIVE=1 npx vitest run src/games/price-check.live.test.ts` takes real listed items
  from Trade (both games), runs the app's own parser → filters → query → valuation and prints the result (opt-in,
  honours the rate-limit headers, waits 6 s after each search).

### Search modes and filters
- **Quick** (default, searched automatically): the default selection; only selected filters are listed, the rest
  under "+N more". **Advanced**: every filter editable, roll-range presets (−10 % min / ±10 % / ±20 % / exact, whole
  numbers: +83 life → 74–92 at ±10 %), item level ≥, corruption. **Base type**: no modifiers, with a warning.
- **Local stats.** On weapons and armour (items with Armour/Evasion/ES/Ward/damage/APS/block properties) flat
  defence/damage/speed lines are searched as their `(Local)` Trade stat. Before, a rare boot's own search could
  return 0 listings (global "+# to Evasion Rating" never matches a local line) — found by the live check.
- **Pseudo totals** also sum attributes (incl. hybrids and all-attributes), mana, energy shield (not on armour, where
  flat ES is local), cast speed, movement speed, global crit multi (PoE 1) and spell damage when **two or more** lines
  add up; the total replaces its lines by default and lists them ("= +20 to Strength + +15 to Strength and Dexterity …").

- **Bulk goods: poe.ninja (Currency Exchange) only.** Currency, tattoos, essences, fossils, oils, omens, fragments,
  divination cards … trade in bulk on the in-game Currency Exchange; the cheapest single Trade listings are stale or
  bait (user reports: The Dragon's Heart 1 c–50 div → "~130 c Low confidence"; Tattoo of the Arohongui Warrior "~15 c"
  while the exchange ratio was 87:1 and poe.ninja 88 c; PoE 2 Divine Orbs listed at "99 waystone-3" → Unpriced).
  `marketLookupCategories` picks the game's poe.ninja *exchange* categories (cards: `divination` only; other
  currency-rarity items, except corpses: all others) and `useExchangePrice` looks the name up through Market Data
  (cache-first; a category still being fetched for the first time is awaited via `market:updated`, max 20 s — the first check after install otherwise saw an empty list and fell back to Trade). Found → the check shows the poe.ninja price per unit/card, full stack/set, the copied stack, 7-day
  change and listing count (`MarketValue.tsx`) and **no Trade request is made**; "Search Trade" runs the normal search
  only on the user's click, and the poe.ninja rate then stays in the summary as a labelled "Market rate", never mixed
  into the listing estimate. The automatic Trade search waits until the lookup is done. A currency item poe.ninja
  doesn't know falls back to the normal Trade search; a card stays on the honest "no price" state. The premium
  currency itself (Divine Orb) is shown in the base unit.

- **Synthesised items (PoE 1).** The copy shows "Synthesised <base>"; Trade only knows the base ("Unknown item base
  type" otherwise — user report, Synthesised Nebulis). The parser strips the prefix and sets `synthesised`; the query adds
  `misc_filters.synthesised_item` (and `fractured_item` for fractured items) — filter ids from `/api/trade/data/filters`.
  The advanced copy's "— Unscalable Value" marker is stripped from modifier text; a weapon's type line ("Sceptre") is
  the `Category` property, not an unparsed line.

### Results, cache, interaction
- Results are cached in memory per game + league + exact query for 5 minutes and always labelled **Cached** (with
  age); **Refresh** searches live. States: Live / Cached / Refreshing / Request failed.
- A newer search supersedes an older one (its late response is dropped); an identical search already running is not
  sent again.
- Listing rows: price with currency icon (poe.ninja icon when known), seller status (online / AFK / offline / instant
  buyout), age, match %, verdict tag; copy price, copy whisper, item details; sort Lowest / Highest / Newest / Best
  match. Prices are shown in the base unit below 1 premium unit (e.g. "2 c", not "0.009 div").

## 6. Overlay window
Created on first use (no idle cost). Transparent, frameless, always on top, not in the taskbar. Drag by header, resize from edges; position/size saved (`overlay.bounds`). Esc or × hides it. **Locked / Quick** (pin button, per game setting `priceCheck.overlayLocked`, default Locked): in Quick mode the host's foreground watcher hides the overlay when the **game window** comes back to the foreground, at least 1 s after it was shown (`quick_close_due` in `overlay/mod.rs`). Switching to another app does not close it. The webview's own blur events were not usable: showing the window shuffles focus (measured: focus at 118 ms, blur at ~1.6 s without any user action). Not yet verified with a running game.

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
