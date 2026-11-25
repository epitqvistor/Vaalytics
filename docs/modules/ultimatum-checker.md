# Ultimatum Checker (PoE 1)

Check an Inscribed Ultimatum with the price-check hotkey: your verdict on its modifiers, what the sacrifice and reward are worth, and a Trade search.

| | |
|---|---|
| Registry id | `ultimatum-checker` · group `endgame` · PoE 1 `ready` · PoE 2 not offered |
| UI | `src/games/poe1/ultimatum/` (`index.tsx` module page, `UltimatumCard.tsx` check card) |
| Logic | `parse.ts` (item text), `ultimatum.ts` (ratings, risk, valuation, Trade query), `data/modifiers.ts` (catalogue) — tested in `ultimatum.test.ts` |
| Data | poe.ninja via the Market engine (`useMarketOverviews`, **market** → shown as **estimate**), modifier names/tiers (**game data**), your ratings (**user**) |
| Patch rules | none — Inscribed Ultimatum is a core PoE 1 item |

## Behaviour

- **Hotkey.** Hover an Inscribed Ultimatum in game and press the Price Checker hotkey (default Ctrl+D). The overlay
  shows the Ultimatum check instead of a Trade price check. Pasting the text into Price Checker does the same.
  The routing is a `SpecialItemView` (`src/shared/views/price-check/special.ts`) supplied by the PoE 1 game module
  (`GAME_MODULES.poe1.special`, `src/games/poe1/price-checker/index.tsx`), so shared views never import `games/poe1`.
  No new clipboard access: the item text is the one the price-check hotkey already reads.
- **Check card.** Challenge, area level, sacrifice and reward; every modifier with the game's own description;
  your rating per modifier (click: Fine → Dangerous → Build-breaking → unrated); verdict; valuation; **Open on Trade**.
- **Module page.** The last checked Ultimatum (parsed fields saved in `ultimatum.last`, never the copied text),
  the **Trial planner** (modifiers offered inside an Ultimatum encounter can't be copied — pick them by name to get
  the same verdict) and **Your ratings** (all penalty modifiers, filterable).
- Verdict: **Skip** (any build-breaking modifier) › **Careful** (any dangerous) › **Rate modifiers** (unrated penalty
  modifiers left) › **Looks fine**. Bonus modifiers (Harsh Lessons, Splintershot, …) and The Trialmaster never count.
  A rating applies to all tiers of a family (Ruin … Ruin IV).

## Calculations (estimate)

Values in chaos. `paid` = what you paid for the Inscribed Ultimatum (optional input, 0 if it dropped).

| Reward | Stake (lost on failure) | Net if completed |
|---|---|---|
| Doubles sacrificed Currency / Divination Cards | count × poe.ninja price | stake − paid (you get 2× back) |
| Unique Item (exchange) | sacrificed unique's price | reward unique's price − stake − paid |
| Mirrored Rare Item | — not priced (a rare can't be priced from its name) | — |

Break-even success rate = −lose / (win − lose) on range midpoints. It is shown as "breaks even if you complete about
X %" — Vaalytics never guesses your success rate. Chaos Orb is the base unit (worth 1 by definition; poe.ninja has no
row for it). Currency sacrifices are looked up by exact name in the exchange categories (currency, fragments,
essences, fossils, resonators, oils, delirium orbs, omens, artifacts); uniques by exact name in the unique categories,
as a low–high range over all poe.ninja rows of that name (links, variants and rolls are not considered — labelled).

## Data integrity

- **Item format** verified against a real Ctrl+C copy (fixture `REAL` in `ultimatum.test.ts`, 2026-11-25):
  `Challenge:`, `Area Level:`, `Requires Sacrifice: <name> x<count>`, `Reward:`, then modifier names each followed by a
  `(…)` description that may span lines. Only "Doubles sacrificed Currency" has been seen; the other reward texts are
  matched by keyword (`divination`, `mirror`, otherwise a unique name) — **unverified** until a real copy is added.
- **Modifier catalogue**: 104 names with tiers from the game's `UltimatumModifiers` table as listed on poedb.tw
  (RePoE has no Ultimatum export; the wiki blocks automated reads). Names only — descriptions are always the game's text
  from the item. Names not in the catalogue are shown as "Unknown" and can't be rated (never guessed).
- **Trade**: filter ids from `https://www.pathofexile.com/api/trade/data/filters` (`ultimatum_filters`:
  `ultimatum_challenge` Exterminate/Survival/Defense/Conquer, `ultimatum_reward` DoubleCurrency/DoubleDivCards/MirrorRare/
  ExchangeUnique, `ultimatum_input`, `ultimatum_output`). The search opens in the browser (no automated Trade request).
  `ultimatum_input`/`ultimatum_output` are "known item" fields filled with the item name — not yet confirmed on the site.
- Prices: cache-first Market engine snapshots with a `FreshnessBar`; when a price is missing the card says so.

## Settings (per game, `poe1`)

| Key | Value |
|---|---|
| `ultimatum.ratings` | `{ [family]: "ok" \| "danger" \| "forbidden" }` |
| `ultimatum.last` | `{ ultimatum: Ultimatum, at: unix ms }` (parsed fields only) |

## Tests

`ultimatum.test.ts`: catalogue (count, unique families, tier lookup), the real item copy (fields, multi-line
description, CRLF, shared parser keeps the base type), non-Ultimatum items, unknown modifiers, sacrifice/reward parsing,
rating cycle + validation, verdict order, valuation (doubling, purchase price, Chaos base unit, missing price, unique
range, mirrored rare), Trade query ids.

## Not yet

- Fixtures for Divination Card, Unique Item and Mirrored Rare Item rewards (need real copies).
- Ctrl+Alt+C (advanced copy) format not seen yet.
- No automated Trade price for the Inscribed Ultimatum itself (the Trade API is behind Cloudflare; the button opens the site).
