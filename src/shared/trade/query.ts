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

export interface SearchOptions {
  onlineOnly: boolean;
  /** Restrict by item level (≥). */
  itemLevelMin: number | null;
  /** Match corrupted state of the item. */
  matchCorrupted: boolean;
  /** PoE 1: require at least this many links. */
  linksMin: number | null;
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
  return {
    onlineOnly: true,
    itemLevelMin: null,
    matchCorrupted: item.corrupted,
    linksMin: item.game === "poe1" && (item.links ?? 0) >= 5 ? item.links! : null,
  };
}

type Json = Record<string, unknown>;

export function buildQuery(item: ParsedItem, stats: readonly StatFilter[], opts: SearchOptions): Json {
  const query: Json = { status: { option: opts.onlineOnly ? "online" : "any" } };

  if (item.rarity === "Unique") {
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
  if (opts.matchCorrupted) misc.corrupted = { option: item.corrupted ? "true" : "false" };
  if (opts.itemLevelMin != null) misc.ilvl = { min: opts.itemLevelMin };
  if (item.rarity === "Gem") {
    if (item.gemLevel != null) misc.gem_level = { min: item.gemLevel };
    if (item.quality != null) misc.quality = { min: item.quality };
  }
  if (Object.keys(misc).length) filters.misc_filters = { filters: misc };

  if (item.game === "poe1" && opts.linksMin != null) filters.socket_filters = { filters: { links: { min: opts.linksMin } } };
  if (item.game === "poe1" && item.mapTier != null) filters.map_filters = { filters: { map_tier: { min: item.mapTier, max: item.mapTier } } };

  if (Object.keys(filters).length) query.filters = filters;
  return { query, sort: { price: "asc" } };
}
