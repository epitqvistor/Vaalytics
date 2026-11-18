# REGEX (PoE 1)

Builds search strings for the in-game search box (stash, vendor, inventory),
keeps them in a library with eight quick slots, and checks them against the
3.30 game data and against items you paste. Vaalytics never types into the
game: strings are copied to the clipboard when you press Copy.

| | |
|---|---|
| Registry id | `regex` · label "REGEX" · group `tools` · PoE 1 ready · PoE 2 not offered |
| UI | `src/games/poe1/regex/index.tsx`, `LibraryPanel.tsx`, `dialogs.tsx` |
| Logic | `syntax.ts` (search syntax, evaluation, number patterns), `fragments.ts` (shortest unique fragment), `categories.ts` (generators), `generator.ts` (build, checks, 250-char split), `reverse.ts`, `presets.ts`, `library.ts` (import/export, duplicates) |
| Tests | `regex.test.ts` on `fixtures/search-3.30.json` (real RePoE 3.30 extract) + the crafting fixture |
| Storage | `src-tauri/src/regex_library.rs`, migration `0005_regex.sql` (tables `regex_library`, `regex_slots`, both with a `game` column) |
| Game data | `crafting_data` (RePoE) — `search` section added in crafting data format 6 |

## Search syntax (English client)

- Terms are separated by spaces and all must match (AND). Double quotes allow spaces inside a term.
- `!` at the start of a term excludes items that match it (`"!a|b"` hides items with a or b).
- Inside a term: case-insensitive regular expression; `|` is OR; `\d`, `[0-9]`, `( )`, `{n}`, `^`/`$`.
- Each term is tested against each line of the item text.
- The box takes **250 characters**.

`evaluate()` implements exactly this and drives "Test against item".

## Generators

| Generator | Options from | Extra filters |
|---|---|---|
| Maps | map mods (`*_tier_map` spawn tags); reward lines that the tooltip shows as properties (Atlas Drops / Rarity of Items found / Pack size) are hidden | tier from/to, quantity (Item Quantity **or** Atlas Drops), rarity, pack size, quality, corrupted, unidentified |
| Vendor | socket syntax: 3+…6+ linked, 6 sockets, R-G-B adjacent; movement speed with a minimum (`^`-anchored so "Minions have … Movement Speed" doesn't match) | — |
| Items | prefixes/suffixes, crafted, veiled/delve and implicit lines (one option per distinct line) | minimum value per wanted option |
| Flasks | flask mods + flask bases | quality |
| Jewels | jewel, abyss jewel and cluster jewel mods | — |
| Expedition | Expedition Logbook area mods | corrupted |
| Heist | contract/blueprint mods + contract/blueprint bases | — |
| Tattoos | tattoo names | — |
| Threads | 3.30 Thread items (Scarabs are gone in 3.30 — there is no Scarab generator) | — |

**Bestiary** has no generator: there is no verified data source for beast names/mods in
our pipeline. "Bestiary" exists as a library category for your own strings.

Options are distinct *lines* (numbers → `#`). Two mods that share a line can't be told
apart by a search, so they are one option.

### Optimisation

For each option the generator searches the shortest literal (3–16 characters, no
numbers, no leading/trailing space) that appears **only** in that option's lines among
all lines of the category corpus (other options, base names, property lines). Quotes
(cost +2) count against a candidate. If none exists, the whole line is used, anchored
with `$` / `^…$` when it is part of a longer line. Every piece is re-checked against
the corpus; any other line it matches is reported under "Checks".

"Value at least N" uses `atLeast(N)` (exact for whole numbers, any length) followed by
the shortest text after the number that is unique to the option.

### 250 characters

Nothing is ever truncated. Over the limit the counter turns red, Copy is disabled and
the string is split:

- one long **wanted** OR term → several searches, the other terms repeated in each; an item
  is a match if it lights up in **any** of them;
- one long **exclusion** → several searches; an item passes only if it lights up in **every** one;
- several terms that each fit → packed into searches that must **all** match;
- two terms both longer than 250 → refused with an explanation (select fewer options).

### Generated vs hand-edited

The text follows the generator until you type in it ("Edited by hand"). After that,
generator changes never overwrite it; "Replace with generated" discards the edits.
Loading a library entry or quick slot also counts as hand-edited.

### Reverse lookup ("Explain")

Splits a string into terms and alternatives and shows for each: the option it matches,
"ambiguous" (several options), "item property or base name", or **unknown — kept as is**.
"Load into the generator" turns single-option alternatives into selections and keeps
everything else (unknown, ambiguous, properties, alternatives with number patterns)
verbatim as extra terms, so regenerating keeps the meaning.

## Library and quick slots

- Save: name, category and regex required; description, tags, notes, favorite optional.
  Names are unique per game, case-insensitive. A collision asks: **Rename** or **Overwrite it**
  (explicit; nothing is written until you choose).
- Categories: Maps, Vendor, Flasks, Items, Jewels, Expedition, Heist, Bestiary, Threads,
  Tattoos, Custom, plus your own folders ("New folder…"). Tags filter too.
- List: search (name, regex, description, tags), category and tag filters, favorites,
  sort by last change / newest / A–Z, collapsible categories. Actions: copy, load,
  edit/rename, duplicate, put in slot, delete (with confirmation), favorite.
- Quick slots 1–8 keep their own copy of the string (still work if the entry is deleted;
  an explicit overwrite repoints them to the new entry).
- Built-in presets are selections resolved against the current data (shown as
  "Built-in · …"); loaded into the generator they can be saved as your own entries.

## Import / export

Export writes `{"format":"vaalytics-regex","version":1,"game":"poe1","entries":[…]}`
through a save dialog (all entries, or the filtered list). Import reads a file the user
picks (≤ 2 MB), validates every row (required fields, lengths, game, version) and shows
rejected rows. For names that already exist: **Keep both** (imported entry renamed
"name (2)"), **Skip**, or **Replace selected** (only ticked names). The library is never
replaced as a whole.

## Data integrity and limits

- Options come from RePoE 3.30 (English). Items' rare names are random and not in the
  corpus; fragments are ≥ 3 characters to keep accidental hits on them rare.
- **Unverified:** the exact 3.30 map tooltip line for the renamed quantity stat. The quantity
  filter matches both `Item Quantity:` and `Atlas Drops:` and says so; confirm with
  "Test against item" on a real map.
- Socket patterns match the `Sockets:` line; R-G-B means the three are adjacent in one link
  group (same as other tools).
- Number patterns handle whole numbers; decimals (e.g. "1.5%") aren't handled.
- Hand-edited strings aren't checked automatically; use Explain / Test against item.
- No keystrokes are sent to the game; the clipboard is only written when you press Copy.
