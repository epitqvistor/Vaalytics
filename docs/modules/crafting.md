# Crafting calculator (PoE 1)

Estimates the chance and expected cost of rolling chosen modifiers on an item,
and ranks crafting methods by expected cost with live poe.ninja prices.
PoE 2 shows the "planned" placeholder (`SECTION_META.crafting.plannedFor`).

| | |
|---|---|
| Rust | `src-tauri/src/crafting.rs` — download, reduce, cache (`crafting_data` command) |
| UI + engine | `src/games/poe1/crafting/` |
| Data | `%APPDATA%\app.vaalytics.desktop\crafting\poe1.json` (+ `.meta.json` with ETags) |

## Data source

[RePoE](https://repoe-fork.github.io) (community export of the game files):
`mods`, `base_items`, `fossils`, `essences`, `item_classes` (~28 MB raw).
Rust reduces it to ~1.5 MB: explicit item prefixes/suffixes, released bases
of the supported classes, plain fossils and non-corruption essences. Translation
markup (`[Tag|Text]`) is stripped. The cache is reused for 24 h, then checked
with `If-None-Match`; on failure the cached copy is used and the UI shows the
error. Bump `FORMAT_VERSION` when the compact format changes.

Supported item classes: jewellery, belts, armour pieces, shields, quivers and
weapons (3 prefixes / 3 suffixes). Jewels, flasks, clusters are not modelled.

## Weights

- First tag of a mod's `spawn_weights` that the item has (base tags + influence
  tags of the class) gives its weight; `generation_weights` multiply it (percent).
- Mods above the item level and `is_essence_only` mods never roll.
- Tiers: per family (`type`) among mods that can spawn on the base, T1 = highest level.
- Fossils: weight × Π (fossil percent / 100) over every matching mod tag
  (`implicit_tags`), floored; 0 blocks. Several fossils multiply (assumption).
  Fossils with special effects (added/forced mods, Glyphic/Tangled, Sanctified,
  Gilded, Hollow, Bloodstained, Fractured, Faceted) are excluded.

## Probability model (`engine.ts`)

- A reforge rolls 4/5/6 explicit mods with odds 8/12, 3/12, 1/12 (not published
  by GGG; widely used community figure). Fixed mods (fractured, essence) count.
- Mods are drawn one at a time proportional to weight from mods whose side has
  room (max 3/3) and whose group isn't on the item.
- Goal-relevant mods are tracked exactly (classes by hit/block mask); other
  mods are merged per side with a size-biased mean-field estimate of the weight
  removed per draw. `simulate.ts` samples the exact process and
  `engine.test.ts` checks model ≈ simulation on real data.
- Alteration/Augmentation: the final prefix is weight-proportional among
  prefixes and the suffix among suffixes, independent of the unknown 1-vs-2
  split; cost assumes an Augmentation every time (upper bound).

## Methods (`methods.ts`)

| Method | Cost per try | Notes |
|---|---|---|
| Chaos spam | 1 Chaos Orb | |
| Alteration + Augmentation | Alt + Aug | magic item; final Regal not counted |
| Alt + Aug + Regal | loop: alts until `need-1` hit, Regal, else Scour + Transmute | expected cost closed form; spread approximated |
| Essences | 1 essence | Shrieking / Deafening (can reforge rares); essence mod fixed |
| Fossils | fossils + Chaotic Resonator (1–3 sockets) | optimizer: single fossils that beat Chaos, top 8 by value, all combos ≤ 3 |

Costs: `costPerTry / chance`; 50/63/90 % costs from `⌈ln(1−p)/ln(1−P)⌉` tries.
A component without a poe.ninja price leaves the method unpriced (listed last).
The comparison runs in a Web Worker (`compare.worker.ts`), debounced.

## UI

Item class, base, item level, up to two influences; pasting game item text
(Ctrl+V anywhere in the section, or the Paste button) sets base, item level,
influences and fractured mods (matched by text + roll range, preferring mods
that can roll on the base). Targets: family + worst accepted tier; All / Any /
At least k. The middle column is the currency emulator (below).

## Currency emulator (`emulator.ts`, `EmulatorPanel.tsx`)

Item state = rarity + mods (with rolled values; fractured mods are kept).
Uses the exact sampler (`sampler.ts`, every mod and group tracked).

| Currency | Rule |
|---|---|
| Transmutation | normal → magic, 1 or 2 mods (max 1 prefix / 1 suffix) |
| Alteration | magic → new 1 or 2 mods (fractured kept) |
| Augmentation | magic with one mod → adds one |
| Regal | magic → rare + 1 mod |
| Alchemy | normal → rare, 4–6 mods |
| Chaos | rare → reforge 4–6 (fractured kept) |
| Exalted | rare with an open side → adds one |
| Annulment | removes a random non-fractured mod |
| Scouring | removes non-fractured mods; normal unless fractured mods remain (then the rarity stays) |
| Essence | normal → rare with the essence mod; Shrieking/Deafening also reforge rares; refused on magic |
| Fossils (1–4) | normal or rare → reforge with fossil weights + matching Chaotic Resonator |

Assumption: Transmutation/Alteration roll 1 or 2 mods with equal odds (not published).
Values roll uniformly inside each range (decimals kept). Shift+click repeats a
currency until the targets hit (Alteration auto-augments one-mod items),
in ~12 ms slices per frame, max 1,000,000 uses, with Stop. Spent currency
is priced with poe.ninja; unpriced items are flagged. A pasted item starts the
emulator with its fractured and recognised explicit mods; crafted / unrecognised
lines are listed as not carried over. "Copy PoB item text" exports the current
emulated item (PoB format, `{fractured}`, `{range:0.5}` for base implicits).

## Monte Carlo (`montecarlo.ts`, `mc.worker.ts`)

For the chosen method: runs real attempts with the exact sampler for ~2.5 s
(max 2M), measuring the success rate and the mean currency cost of failed and
successful attempts. Then samples 10,000 complete crafts (geometric number of
attempts) for the 25/50/75/90 % cost and tries, a 24-bin histogram (last bin =
98th percentile and above) and the measured vs model chance. With no hits the
spread uses the model chance (shown). Runs in its own worker; cancellable.

## Harvest, Eldritch, bench (stage 3)

**Harvest** (`harvest.ts`): the 16 "Reforge a Rare item with random modifiers,
including a <tag> modifier" crafts. RePoE has no Harvest data; costs come from
poedb Horticrafting (checked 2026-11-17), Lifeforce / Rancour prices from
poe.ninja. Model: one mod with the tag (mod `implicit_tags`) is drawn first,
weight-proportional among rollable mods, then a normal reforge
(`taggedReforgeChance`). Best three tags are ranked with the other methods.
"More/less likely" and influence reforges are not modelled (multipliers unknown).

**Bench** (`data.bench`, `data.craftedMods` from RePoE `crafting_bench_options`):
every explicit craft for the class with its cost, plus metamods.
Supported metamods: Prefixes/Suffixes cannot be changed, Cannot roll
Attack/Caster Modifiers. Not modelled: "1/2 … cannot be changed", multi-mod.
One crafted mod per item.

Metamod rules (confirmed by the user, PoE 1):
- "… cannot be changed" is respected by Chaos, Scouring, Annulment, Harvest
  (and Veiled Orb, not emulated); essences and fossils ignore it.
- A respected reroll keeps the locked side and fractured mods, rolls only the
  other side (total 4–6, assumption) and removes the metamod with that side.
- "Cannot roll X" removes every mod with tag X from rolls (Exalt, Chaos,
  Harvest, Eldritch, magic currencies); essences/fossils ignore it.

**Eldritch**: Searing Exarch / Eater of Worlds tiers are set in the item bar
(body armour, helmet, gloves, boots). Higher tier dominates (Exarch →
prefixes, Eater → suffixes); equal tiers → no dominance. Eldritch Chaos
rerolls the dominant side (keeps the other side), Eldritch Exalt adds to it,
Eldritch Annulment removes from it. Implicit rolling (Embers/Ichors) is not
emulated.

**Next step** (`nextsteps.ts`, `NextStepsPanel.tsx`): for the current emulated or
pasted rare item: Exalt; "Cannot roll Attack/Caster" + Exalt (only when it
beats a plain Exalt; the metamod takes a suffix slot); Eldritch Exalt / Chaos;
"Lock prefixes/suffixes" + Chaos or + the best two Harvest reforges (the
metamod needs a free slot on the other side and is recrafted each try).
One-shot steps show cost per try; repeatable steps average cost ÷ chance.
`stage3.test.ts` checks locked / tagged / single-add chances against the exact
sampler.

## Not yet

Bestiary (Wild Bristle Matron: which metamod it adds isn't documented),
Harvest "more/less likely", Eldritch implicit rolling, jewels, PoE 2.
