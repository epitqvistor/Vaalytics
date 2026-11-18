/**
 * Builds editable search filters from a parsed item, and turns the user's
 * selection into an official Trade search query.
 */
import type { ParsedItem } from "@/shared/item-parser/types";
import { matchMod, mergeMultiline, pseudoTotals, type StatIndex } from "./stats";

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

/** Suggested minimum: 90 % of the item's roll, floored (keeps comparable items in range). */
export function suggestedMin(value: number | null): number | null {
  if (value == null) return null;
  if (value <= 0) return Math.round(value * 100) / 100;
  const v = value * 0.9;
  return value >= 10 ? Math.floor(v) : Math.floor(v * 10) / 10;
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
  const coveredByPseudo = new Set(pseudo.filter((p) => preferredPseudo.has(p.id)).flatMap((p) => p.from));


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
    });
  }

  for (const mod of mergeMultiline(item.mods, index)) {
    const match = matchMod(mod, index);
    if (!match) {
      unmatched.push({ id: mod.id, text: mod.text });
      continue;
    }
    const highTier = mod.tier != null ? mod.tier <= 2 : true;
    const enabledByDefault =
      !priceByName &&
      !coveredByPseudo.has(mod.id) &&
      (mod.kind === "fractured" || (mod.kind === "explicit" && highTier)) &&
      match.value != null;
    stats.push({
      key: mod.id,
      statId: match.stat.id,
      label: mod.text,
      value: match.value,
      min: suggestedMin(match.value),
      max: null,
      enabled: enabledByDefault,
      source: "mod",
      kind: mod.kind,
      tier: mod.tier,
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
    // Magic items carry affixes in their name; the base can't be isolated without base-type data.
    query.type = item.baseType;
  }

  const enabled = stats.filter((s) => s.enabled);
  if (enabled.length) {
    query.stats = [
      {
        type: "and",
        filters: enabled.map((s) => ({
          id: s.statId,
          value: { ...(s.min != null ? { min: s.min } : {}), ...(s.max != null ? { max: s.max } : {}) },
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
