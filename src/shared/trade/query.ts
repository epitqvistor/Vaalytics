/**
 * Builds editable search filters from a parsed item, and turns the user's
 * selection into an official Trade search query.
 */
import type { ParsedItem } from "@/shared/item-parser/types";
import { hasLocalStats, matchMod, mergeMultiline, pseudoTotals, SUM_PSEUDO_IDS, type StatIndex } from "./stats";

export interface StatFilter {
  key: string;
  statId: string;
  label: string;
  /** The item's own value for this stat (direction-adjusted). */
  value: number | null;
  min: number | null;
  max: number | null;
  enabled: boolean;
  source: "mod" | "pseudo";
  kind: string;
  tier?: number;
  /**
   * Option stats (cluster jewel "Added Small Passive Skills grant: …", Trade id
   * `stat|option`) have no numeric value: they are searched as `{ option }`.
   * Sending a min for them makes Trade return 0 results.
   */
  option?: number | string;
  /** Pseudo totals: the item lines that add up to the value (shown so the sum can be checked). */
  sources?: string[];
}

export interface FilterSet {
  stats: StatFilter[];
  /** Mods that could not be matched to a Trade stat (reported, not searched). */
  unmatched: { id: string; text: string }[];
}

/**
 * Trade listing status. PoE 1 3.30 has instant-buyout (merchant) listings whose
 * sellers needn't be online: "available" (the Trade site's default) = instant
 * buyout + online in person; "online" excludes instant buyout.
 */
export type TradeStatus = "available" | "securable" | "online" | "any";
export const STATUS_OPTIONS: Record<"poe1" | "poe2", { value: TradeStatus; label: string }[]> = {
  poe1: [
    { value: "available", label: "Instant buyout + online" },
    { value: "securable", label: "Instant buyout only" },
    { value: "online", label: "Online sellers only" },
    { value: "any", label: "Any (incl. offline)" },
  ],
  // PoE 2 Trade has no instant-buyout listings (checked 2026-11-17).
  poe2: [
    { value: "online", label: "Online sellers only" },
    { value: "any", label: "Any (incl. offline)" },
  ],
};

export type Range = { min: number | null; max: number | null };

export interface SearchOptions {
  status: TradeStatus;
  /** Restrict by item level (≥). */
  itemLevelMin: number | null;
  /** Corrupted state: any, only corrupted, only uncorrupted. */
  corrupted: "any" | "yes" | "no";
  /** PoE 1: require at least this many links. */
  linksMin: number | null;
  /** Gems: level and quality ranges (null = no limit). */
  gemLevel: Range;
  gemQuality: Range;
}

const PRICE_BY_NAME = new Set(["Unique", "Gem", "Currency", "Divination Card"]);

/**
 * Suggested minimum in whole numbers: 90 % of the item's roll, floored, for
 * rolls ≥ 10; smaller rolls keep their own (floored) value, since 90 % of a
 * small number only drops a step. Rolls below 1 (e.g. 0.4 % leech) stay as
 * they are — rounding would make the filter meaningless.
 */
export function suggestedMin(value: number | null): number | null {
  if (value == null) return null;
  if (value < 0) return Math.round(value);
  if (value < 1) return Math.round(value * 100) / 100;
  return value >= 10 ? Math.floor(value * 0.9) : Math.floor(value);
}

/** Trade lists option values as separate stats with ids like `enchant.stat_3948993189|42`. */
export function splitOptionId(id: string): { id: string; option?: number | string } {
  const i = id.indexOf("|");
  if (i < 0) return { id };
  const raw = id.slice(i + 1);
  return { id: id.slice(0, i), option: /^\d+$/.test(raw) ? Number(raw) : raw };
}

const CLUSTER_BASE = /(?:Small|Medium|Large) Cluster Jewel/;

/** Cluster jewel base, also from a magic item's affixed name ("Lustrous Small Cluster Jewel of …"). */
export function clusterBase(item: ParsedItem): string | null {
  return CLUSTER_BASE.exec(item.baseType)?.[0] ?? null;
}

/**
 * Default selection heuristic. Modifiers are not equally valuable, so only a
 * subset starts enabled: pseudo totals (life/resistances) and high-tier
 * explicit or fractured mods. Everything stays editable.
 */
export function buildFilters(item: ParsedItem, index: StatIndex): FilterSet {
  const priceByName = PRICE_BY_NAME.has(item.rarity);
  const pseudo = pseudoTotals(item, index);
  // Prefer the broadest resistance pseudo present (total elemental when the item
  // mixes sources, otherwise "total to all Elemental Resistances"), plus life/chaos.
  const hasTotalEle = pseudo.some((p) => p.id === "pseudo.pseudo_total_elemental_resistance");
  const preferredPseudo = new Set([
    hasTotalEle ? "pseudo.pseudo_total_elemental_resistance" : "pseudo.pseudo_total_all_elemental_resistances",
    "pseudo.pseudo_total_life",
    "pseudo.pseudo_total_chaos_resistance",
  ]);
  // Sums of two or more lines (attributes, mana, speed, …) replace their lines by default too.
  for (const p of pseudo) if (SUM_PSEUDO_IDS.has(p.id)) preferredPseudo.add(p.id);
  const coveredByPseudo = new Set(pseudo.filter((p) => preferredPseudo.has(p.id)).flatMap((p) => p.from));
  const textOf = new Map(item.mods.map((m) => [m.id, m.text]));


  const stats: StatFilter[] = [];
  const unmatched: FilterSet["unmatched"] = [];

  const craftedIds = new Set(item.mods.filter((m) => m.kind === "crafted").map((m) => m.id));
  for (const p of pseudo) {
    // Totals made only of crafted mods are cheap to reproduce; don't price on them by default.
    const onlyCrafted = p.from.every((id) => craftedIds.has(id));
    stats.push({
      key: p.id,
      statId: p.id,
      label: p.label,
      value: p.value,
      min: suggestedMin(p.value),
      max: null,
      enabled: !priceByName && preferredPseudo.has(p.id) && !onlyCrafted,
      source: "pseudo",
      kind: "pseudo",
      sources: p.from.map((id) => textOf.get(id) ?? id),
    });
  }

  const cluster = item.game === "poe1" && clusterBase(item) != null;
  // Corpses (Necropolis): their lines are the monster's fixed abilities, defined by the base type
  // and not searchable on Trade — the base type is the search, nothing is "unmatched".
  const corpse = item.itemClass === "Corpses";
  const local = hasLocalStats(item);
  for (const mod of mergeMultiline(item.mods, index)) {
    const match = corpse ? null : matchMod(mod, index, local);
    if (!match) {
      if (!corpse) unmatched.push({ id: mod.id, text: mod.text });
      continue;
    }
    const { id: statId, option } = splitOptionId(match.stat.id);
    // A cluster jewel is defined by its enchants (passive count, sockets, passive type): match them exactly.
    const clusterEnchant = cluster && mod.kind === "enchant";
    const highTier = mod.tier != null ? mod.tier <= 2 : true;
    const enabledByDefault =
      clusterEnchant ||
      (!priceByName &&
        !coveredByPseudo.has(mod.id) &&
        (mod.kind === "fractured" || (mod.kind === "explicit" && highTier)) &&
        (match.value != null || option != null));
    const value = option != null ? null : match.value;
    stats.push({
      key: mod.id,
      statId,
      label: mod.text,
      value,
      min: clusterEnchant ? value : suggestedMin(value),
      max: clusterEnchant ? value : null,
      enabled: enabledByDefault,
      source: "mod",
      kind: mod.kind,
      tier: mod.tier,
      ...(option != null ? { option } : {}),
    });
  }
  return { stats, unmatched };
}

export function defaultOptions(item: ParsedItem): SearchOptions {
  const gem = item.rarity === "Gem";
  return {
    status: item.game === "poe1" ? "available" : "online",
    itemLevelMin: null,
    // Corruption changes a gem's value a lot (and what it can become), so gems match it exactly.
    corrupted: item.corrupted ? "yes" : gem ? "no" : "any",
    linksMin: item.game === "poe1" && (item.links ?? 0) >= 5 ? item.links! : null,
    gemLevel: { min: gem ? (item.gemLevel ?? null) : null, max: null },
    gemQuality: { min: gem && item.quality ? item.quality : null, max: null },
  };
}

type Json = Record<string, unknown>;

/** Trade `type` for a gem: transfigured gems are base gem + discriminator. */
export function gemType(item: ParsedItem, variants: readonly { text: string; type: string; disc: string }[]): Json | string {
  const v = variants.find((g) => g.text === item.baseType);
  return v ? { option: v.type, discriminator: v.disc } : item.baseType;
}

export function buildQuery(
  item: ParsedItem,
  stats: readonly StatFilter[],
  opts: SearchOptions,
  gemVariants: readonly { text: string; type: string; disc: string }[] = [],
): Json {
  const query: Json = { status: { option: opts.status } };

  if (item.rarity === "Gem") {
    query.type = gemType(item, gemVariants);
  } else if (item.rarity === "Unique") {
    if (item.name) query.name = item.name;
    query.type = item.baseType;
  } else if (item.rarity !== "Magic") {
    query.type = item.baseType;
  } else {
    // Magic items carry affixes in their name; the base can't be isolated without base-type data,
    // except for bases we can recognise inside the name (cluster jewels).
    const base = clusterBase(item);
    if (base) query.type = base;
  }

  const enabled = stats.filter((s) => s.enabled);
  if (enabled.length) {
    query.stats = [
      {
        type: "and",
        filters: enabled.map((s) => ({
          id: s.statId,
          value: s.option != null ? { option: s.option } : { ...(s.min != null ? { min: s.min } : {}), ...(s.max != null ? { max: s.max } : {}) },
          disabled: false,
        })),
      },
    ];
  }

  const filters: Json = {};
  if (item.rarity === "Rare" || item.rarity === "Magic") {
    filters.type_filters = { filters: { rarity: { option: item.rarity === "Rare" ? "rare" : "magic" } } };
  } else if (item.rarity === "Unique") {
    filters.type_filters = { filters: { rarity: { option: "unique" } } };
  }

  const misc: Json = {};
  if (opts.corrupted !== "any") misc.corrupted = { option: opts.corrupted === "yes" ? "true" : "false" };
  if (opts.itemLevelMin != null) misc.ilvl = { min: opts.itemLevelMin };
  // PoE 1 item kinds Trade filters on (verified in /api/trade/data/filters): a synthesised or fractured
  // item is only comparable with its own kind.
  if (item.game === "poe1" && item.synthesised) misc.synthesised_item = { option: "true" };
  if (item.game === "poe1" && item.fractured) misc.fractured_item = { option: "true" };
  if (item.rarity === "Gem") {
    const range = (r: Range) => (r.min == null && r.max == null ? null : { ...(r.min != null ? { min: r.min } : {}), ...(r.max != null ? { max: r.max } : {}) });
    const level = range(opts.gemLevel);
    const quality = range(opts.gemQuality);
    if (level) misc.gem_level = level;
    if (quality) misc.quality = quality;
  }
  if (Object.keys(misc).length) filters.misc_filters = { filters: misc };

  if (item.game === "poe1" && opts.linksMin != null) filters.socket_filters = { filters: { links: { min: opts.linksMin } } };
  if (item.game === "poe1" && item.mapTier != null) filters.map_filters = { filters: { map_tier: { min: item.mapTier, max: item.mapTier } } };

  if (Object.keys(filters).length) query.filters = filters;
  return { query, sort: { price: "asc" } };
}

/**
 * The official Trade site's URL for a search query (`?q=` carries the query JSON), used when the
 * API refuses automated searches: the user can open the same search in their browser.
 */
export function tradeSiteSearchUrl(game: "poe1" | "poe2", league: string, query: Json): string {
  const path = game === "poe1" ? `trade/search/${encodeURIComponent(league)}` : `trade2/search/poe2/${encodeURIComponent(league)}`;
  return `https://www.pathofexile.com/${path}?q=${encodeURIComponent(JSON.stringify(query))}`;
}

// ---------- search modes, basis, roll ranges ----------

/**
 * Quick: the default selection, searched automatically. Advanced: every filter editable.
 * Base type: no modifiers at all — results are never presented as a valuation of the item.
 */
export type SearchMode = "quick" | "advanced" | "base";

/** Items identified by what they are (name/base), not by rolled modifiers. */
export function pricedByIdentity(item: ParsedItem): boolean {
  return PRICE_BY_NAME.has(item.rarity) || item.rarity === "Other" || item.itemClass === "Corpses" || (item.rarity === "Normal" && item.mods.length === 0);
}

/** What a search with these filters actually compares (drives the confidence model). */
export function searchBasis(item: ParsedItem, stats: readonly StatFilter[]): "exact" | "stats" | "base" {
  if (stats.some((s) => s.enabled)) return "stats";
  return pricedByIdentity(item) ? "exact" : "base";
}

export type RangePreset = "min10" | "pm10" | "pm20" | "exact";
export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "min10", label: "−10 % min" },
  { value: "pm10", label: "±10 %" },
  { value: "pm20", label: "±20 %" },
  { value: "exact", label: "Exact" },
];

/**
 * Whole-number min/max around a roll. "min10" leaves max open (better rolls are pricier and sort
 * after cheaper ones anyway); the ± presets bound both sides so only similar items are compared.
 */
export function rangeFor(value: number | null, preset: RangePreset): { min: number | null; max: number | null } {
  if (value == null) return { min: null, max: null };
  if (preset === "min10") return { min: suggestedMin(value), max: null };
  if (preset === "exact") return { min: value, max: value };
  const p = preset === "pm10" ? 0.1 : 0.2;
  if (value < 0) return { min: Math.floor(value * (1 + p)), max: Math.ceil(value * (1 - p)) };
  if (value < 1) return { min: Math.round(value * (1 - p) * 100) / 100, max: Math.round(value * (1 + p) * 100) / 100 };
  return { min: Math.floor(value * (1 - p)), max: Math.ceil(value * (1 + p)) };
}

/** Applies a roll range to every numeric filter (option stats and exact cluster enchants keep theirs). */
export function applyRange(stats: readonly StatFilter[], preset: RangePreset): StatFilter[] {
  return stats.map((s) => (s.option != null || (s.kind === "enchant" && s.min != null && s.min === s.max) ? s : { ...s, ...rangeFor(s.value, preset) }));
}

/** Base type mode switches every filter off; leaving it restores the default selection. */
export function applyMode(stats: readonly StatFilter[], defaults: readonly StatFilter[], mode: SearchMode): StatFilter[] {
  if (mode === "base") return stats.map((s) => ({ ...s, enabled: false }));
  const def = new Map(defaults.map((d) => [d.key, d.enabled]));
  return stats.map((s) => ({ ...s, enabled: s.enabled || (def.get(s.key) ?? false) }));
}
