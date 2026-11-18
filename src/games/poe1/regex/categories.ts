/**
 * Generator categories built from versioned game data (RePoE via Rust
 * `crafting_data`, patch 3.30, English client). Options are distinct *lines*,
 * because the in-game search tests lines: two mods sharing a line can't be
 * told apart, so they are one option.
 */
import type { CraftingData } from "@/games/poe1/crafting/types";
import { FragmentIndex, normalizeLine, type CorpusLine } from "./fragments";
import { atLeast, between, type Term } from "./syntax";

export type SearchMod = { id: string; text: string; gen: string; tags: string[] };
export type SearchData = {
  mapMods: SearchMod[];
  logbookMods: SearchMod[];
  flaskMods: SearchMod[];
  jewelMods: SearchMod[];
  clusterMods: SearchMod[];
  heistMods: SearchMod[];
  bases: Record<string, string[]>;
};

export const LIBRARY_CATEGORIES = ["Maps", "Vendor", "Flasks", "Items", "Jewels", "Expedition", "Heist", "Bestiary", "Threads", "Tattoos", "Custom"] as const;

export type CategoryId = "maps" | "vendor" | "items" | "flasks" | "jewels" | "expedition" | "heist" | "tattoos" | "threads";

export interface Option {
  id: string;
  label: string;
  group: string;
  /** Lines as they appear on items (numbers may be ranges). */
  lines: string[];
  /** Has a rolled number the "at least" filter can use. */
  numeric: boolean;
  /** Hand-written pattern (vendor sockets); bypasses fragment search. */
  fixed?: string;
  /** For fixed numeric options: builds the alternative for a minimum. */
  fixedMin?: (n: number) => string;
}

export type PropValue = number | "any" | "yes" | "no" | null;

export interface PropDef {
  id: string;
  label: string;
  kind: "min" | "max" | "tri";
  /** Term for this value, or null when the filter is off. */
  term: (v: PropValue, all: Record<string, PropValue>) => Term | null;
  /** Shown next to the control when the game text behind it is not verified. */
  unverified?: string;
}

export interface Category {
  id: CategoryId;
  label: string;
  library: (typeof LIBRARY_CATEGORIES)[number];
  description: string;
  options: Option[];
  props: PropDef[];
  index: FragmentIndex;
  /** Where the option data comes from (shown in the UI). */
  source: string;
}

/** Map mods carry reward stats the tooltip shows as map properties, not as mod lines. */
const HIDDEN_MAP_LINE = /^(\S+% increased Atlas Drops in this Area|\S+% increased Rarity of Items found in this Area|\S+% increased Pack size)$/i;

const genLabel = (g: string) => (g === "prefix" ? "Prefix" : g === "suffix" ? "Suffix" : g === "enchantment" ? "Enchant" : g === "implicit" ? "Implicit" : g === "corrupted" ? "Corrupted" : "Other");

/** Distinct visible lines → options. */
function lineOptions(mods: readonly { text: string; gen: string }[], prefix: string, hide?: RegExp): Option[] {
  const by = new Map<string, Option & { gens: Set<string> }>();
  for (const m of mods) {
    for (const raw of m.text.split("\n")) {
      const line = raw.trim();
      if (!line || hide?.test(line)) continue;
      const key = normalizeLine(line);
      let o = by.get(key);
      if (!o) {
        o = { id: `${prefix}:${key}`, label: labelOf(line), group: "", lines: [], numeric: key.includes("#"), gens: new Set() };
        by.set(key, o);
      }
      if (!o.lines.includes(line)) o.lines.push(line);
      o.gens.add(genLabel(m.gen));
    }
  }
  return [...by.values()]
    .map(({ gens, ...o }) => ({ ...o, group: [...gens].sort().join(" / ") }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}

/** "+(80-89) to maximum Life" → "+# to maximum Life" (readable, keeps case). */
export const labelOf = (line: string) => line.replace(/\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)/g, "#").replace(/\d+(?:\.\d+)?/g, "#");

const nameOptions = (names: readonly string[], prefix: string, group: string): Option[] =>
  [...new Set(names)].sort().map((n) => ({ id: `${prefix}:${n.toLowerCase()}`, label: n, group, lines: [n], numeric: false }));

const corpusOf = (options: readonly Option[], unowned: readonly string[]): CorpusLine[] => [
  ...options.flatMap((o) => o.lines.map((text) => ({ text, owner: o.id }))),
  ...unowned.map((text) => ({ text, owner: null })),
];

const minProp = (id: string, label: string, pattern: (n: string) => string, unverified?: string): PropDef => ({
  id,
  label,
  kind: "min",
  unverified,
  term: (v) => (typeof v === "number" && v > 0 ? { alts: [pattern(atLeast(v))] } : null),
});

const triProp = (id: string, label: string, regex: string): PropDef => ({
  id,
  label,
  kind: "tri",
  term: (v) => (v === "yes" ? { alts: [regex] } : v === "no" ? { negate: true, alts: [regex] } : null),
});

/** Lines every map shows besides its mods (from the English client tooltip). */
const MAP_PROPERTY_LINES = [
  "Item Class: Maps",
  "Rarity: Normal",
  "Rarity: Magic",
  "Rarity: Rare",
  "Rarity: Unique",
  "Map Tier: 16",
  "Item Quantity: +80% (augmented)",
  "Atlas Drops: +80% (augmented)",
  "Item Rarity: +40% (augmented)",
  "Monster Pack Size: +25% (augmented)",
  "Quality: +20% (augmented)",
  "Item Level: 83",
  "Monster Level: 83",
  "Corrupted",
  "Unidentified",
  "Travel to this Map by using it in a personal Map Device. Maps can only be used once.",
];

const ATLAS_DROPS_NOTE =
  "3.30 renamed Item Quantity to Atlas Drops; the exact tooltip line isn't verified yet, so both spellings are matched. Check with “Test against item”.";

function mapProps(): PropDef[] {
  return [
    {
      id: "tierMin",
      label: "Tier from",
      kind: "min",
      term: (v, all) => tierTerm(v, all.tierMax ?? null),
    },
    { id: "tierMax", label: "Tier to", kind: "max", term: (v, all) => (typeof all.tierMin === "number" && all.tierMin > 0 ? null : tierTerm(1, v)) },
    minProp("quantity", "Quantity ≥", (n) => `(tity|rops): \\+${n}%`, ATLAS_DROPS_NOTE),
    minProp("rarity", "Item Rarity ≥", (n) => `m rarity: \\+${n}%`),
    minProp("packSize", "Pack Size ≥", (n) => `ze: \\+${n}%`),
    minProp("quality", "Quality ≥", (n) => `ality: \\+${n}%`),
    triProp("corrupted", "Corrupted", "^corrupted$"),
    triProp("unidentified", "Unidentified", "^unidentified$"),
  ];
}

function tierTerm(min: PropValue, max: PropValue): Term | null {
  const lo = typeof min === "number" && min > 0 ? min : 1;
  const hi = typeof max === "number" && max > 0 ? max : 17;
  if (lo <= 1 && hi >= 17) return null;
  if (lo > hi) return null;
  return { alts: [`tier: ${between(lo, hi)}$`] };
}

/** Vendor patterns: sockets and links are plain text ("Sockets: R-G-B B"). */
const S = "[rgbwa]";
function vendorOptions(): Option[] {
  const link = (n: number): Option => ({
    id: `vendor:link${n}`,
    label: `${n}+ linked sockets (any colours)`,
    group: "Links",
    lines: [`Sockets: ${Array(n).fill("R").join("-")}`],
    numeric: false,
    fixed: `(${S}-){${n - 1}}${S}`,
  });
  const perms = ["r-g-b", "r-b-g", "g-r-b", "g-b-r", "b-r-g", "b-g-r"];
  return [
    link(3),
    link(4),
    link(5),
    link(6),
    { id: "vendor:sockets6", label: "6 sockets (any links)", group: "Sockets", lines: ["Sockets: R G B R G B"], numeric: false, fixed: `${S}([- ]${S}){5}` },
    {
      id: "vendor:chromatic",
      label: "R, G and B linked next to each other (chromatic)",
      group: "Sockets",
      lines: ["Sockets: R-G-B"],
      numeric: false,
      fixed: perms.join("|"),
    },
    {
      id: "vendor:movespeed",
      label: "#% increased Movement Speed",
      group: "Mods",
      lines: ["10% increased Movement Speed"],
      numeric: true,
      fixed: "^\d+% increased mov",
      fixedMin: (n) => `^${atLeast(n)}% increased mov`,
    },
  ];
}

export function buildCategories(data: CraftingData & { search?: SearchData }): Category[] {
  const s = data.search;
  const out: Category[] = [];
  const allBases = [...new Set([...data.bases.map((b) => b.name), ...Object.values(s?.bases ?? {}).flat()])];
  const itemLinesUnowned = [...new Set([...data.bases.flatMap((b) => b.implicits), ...data.craftedMods.map((m) => m.text), ...(data.extraMods ?? []).map((m) => m.text)])]
    .flatMap((t) => t.split("\n"))
    .filter(Boolean);

  // The fragment index is built on first use (all categories at once take ~0.5 s).
  const make = (c: Omit<Category, "index">, unowned: string[]): Category => {
    let idx: FragmentIndex | null = null;
    return Object.defineProperty({ ...c } as Category, "index", { get: () => (idx ??= new FragmentIndex(corpusOf(c.options, unowned))), enumerable: true });
  };

  if (s) {
    const mapOpts = lineOptions(s.mapMods, "map", HIDDEN_MAP_LINE);
    out.push(
      make(
        {
          id: "maps",
          label: "Maps",
          library: "Maps",
          description: "Highlight or hide maps by mod, tier and reward properties.",
          options: mapOpts,
          props: mapProps(),
          source: `${s.mapMods.length} map mods (RePoE, 3.30)`,
        },
        [...MAP_PROPERTY_LINES, ...(s.bases.Map ?? [])],
      ),
    );
  }

  const vendor = vendorOptions();
  out.push(
    make(
      {
        id: "vendor",
        label: "Vendor",
        library: "Vendor",
        description: "Vendor and stash: links, socket colours, movement speed.",
        options: vendor,
        props: [],
        source: "Socket syntax of the item text; checked against item mods and base names",
      },
      [...allBases, ...itemLinesUnowned, ...data.mods.flatMap((m) => m.text.split("\n"))],
    ),
  );

  // Crafted, veiled and implicit lines are the same stat to a search: one option each.
  const itemOpts = lineOptions(
    [
      ...data.mods.filter((m) => m.gen === "prefix" || m.gen === "suffix"),
      ...data.craftedMods,
      ...(data.extraMods ?? []),
      ...data.bases.flatMap((b) => b.implicits.map((text) => ({ text, gen: "implicit" }))),
    ],
    "item",
  );
  out.push(
    make(
      {
        id: "items",
        label: "Items",
        library: "Items",
        description: "Equipment mods (prefixes and suffixes), with an optional minimum value.",
        options: itemOpts,
        props: [],
        source: `${data.mods.length} item mods (RePoE, 3.30)`,
      },
      allBases,
    ),
  );

  if (s) {
    const flaskOpts = [
      ...lineOptions(s.flaskMods, "flask"),
      ...nameOptions(
        ["LifeFlask", "ManaFlask", "HybridFlask", "UtilityFlask"].flatMap((k) => s.bases[k] ?? []),
        "flaskbase",
        "Base",
      ),
    ];
    out.push(
      make(
        {
          id: "flasks",
          label: "Flasks",
          library: "Flasks",
          description: "Flask mods and bases, with quality.",
          options: flaskOpts,
          props: [minProp("quality", "Quality ≥", (n) => `ality: \\+${n}%`)],
          source: `${s.flaskMods.length} flask mods (RePoE, 3.30)`,
        },
        ["Quality: +20% (augmented)", "Item Level: 84", "Rarity: Magic", ...(s.bases.Tincture ?? [])],
      ),
    );

    const jewelOpts = [...lineOptions(s.jewelMods, "jewel"), ...lineOptions(s.clusterMods, "cluster").map((o) => ({ ...o, group: `Cluster · ${o.group}` }))];
    out.push(
      make(
        {
          id: "jewels",
          label: "Jewels",
          library: "Jewels",
          description: "Jewel, abyss jewel and cluster jewel mods.",
          options: jewelOpts,
          props: [],
          source: `${s.jewelMods.length + s.clusterMods.length} jewel mods (RePoE, 3.30)`,
        },
        [...(s.bases.Jewel ?? []), ...(s.bases.AbyssJewel ?? [])],
      ),
    );

    out.push(
      make(
        {
          id: "expedition",
          label: "Expedition",
          library: "Expedition",
          description: "Expedition Logbook area mods.",
          options: lineOptions(s.logbookMods, "logbook", HIDDEN_MAP_LINE),
          props: [triProp("corrupted", "Corrupted", "^corrupted$")],
          source: `${s.logbookMods.length} logbook mods (RePoE, 3.30)`,
        },
        ["Expedition Logbook", "Item Class: Expedition Logbooks", "Area Level: 83", "Corrupted", "Unidentified"],
      ),
    );

    out.push(
      make(
        {
          id: "heist",
          label: "Heist",
          library: "Heist",
          description: "Contract and blueprint mods and targets.",
          options: [...lineOptions(s.heistMods, "heist"), ...nameOptions([...(s.bases.HeistContract ?? []), ...(s.bases.HeistBlueprint ?? [])], "heistbase", "Base")],
          props: [],
          source: `${s.heistMods.length} heist mods (RePoE, 3.30)`,
        },
        ["Area Level: 83", "Corrupted", "Unidentified"],
      ),
    );

    if (s.bases.Tattoo?.length) {
      out.push(
        make(
          {
            id: "tattoos",
            label: "Tattoos",
            library: "Tattoos",
            description: "Tattoos by name.",
            options: nameOptions(s.bases.Tattoo, "tattoo", "Tattoo"),
            props: [],
            source: `${s.bases.Tattoo.length} tattoos (RePoE, 3.30)`,
          },
          allBases.filter((b) => !s.bases.Tattoo!.includes(b)),
        ),
      );
    }
    if (s.bases.Thread?.length) {
      out.push(
        make(
          {
            id: "threads",
            label: "Threads",
            library: "Threads",
            description: "3.30 Threads (they replace Scarabs).",
            options: nameOptions(s.bases.Thread, "thread", "Thread"),
            props: [],
            source: `${s.bases.Thread.length} Thread items (RePoE, 3.30)`,
          },
          allBases.filter((b) => !s.bases.Thread!.includes(b)),
        ),
      );
    }
  }
  return out;
}
