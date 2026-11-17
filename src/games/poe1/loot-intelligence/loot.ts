/**
 * Loot Intelligence (PoE 1): which drops are worth picking up in the selected
 * league, from live poe.ninja prices, plus a loot-filter block to paste into
 * an existing filter. No drop rates, nothing estimated as a price.
 * Spec: docs/modules/loot-intelligence.md
 */
import type { MarketItemRow, MarketSnapshot } from "@/core/ipc/commands";

/** Value thresholds in the base unit (chaos), highest first. (Type alias: stored as a JSON setting.) */
export type TierThresholds = {
  top: number;
  valuable: number;
  pickup: number;
};
export type Tier = "top" | "valuable" | "pickup" | "ignore";
export const TIERS: Exclude<Tier, "ignore">[] = ["top", "valuable", "pickup"];
export const TIER_LABEL: Record<Tier, string> = { top: "Top", valuable: "Valuable", pickup: "Pick up", ignore: "Below pick-up" };
export const DEFAULT_THRESHOLDS: TierThresholds = { top: 100, valuable: 10, pickup: 1 };

export function tierOf(value: number, t: TierThresholds): Tier {
  return value >= t.top ? "top" : value >= t.valuable ? "valuable" : value >= t.pickup ? "pickup" : "ignore";
}

export function isThresholds(v: unknown): v is TierThresholds {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  const ok = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
  return ok(t.top) && ok(t.valuable) && ok(t.pickup) && (t.top as number) >= (t.valuable as number) && (t.valuable as number) >= (t.pickup as number);
}

/** Stackable / BaseType-filterable categories (catalog ids) and their filter class. */
export const STACKABLE_CATEGORIES: { id: string; filterClass: string | null }[] = [
  { id: "currency", filterClass: null },
  { id: "fragments", filterClass: null },
  { id: "essences", filterClass: null },
  { id: "fossils", filterClass: null },
  { id: "resonators", filterClass: null },
  { id: "oils", filterClass: null },
  { id: "delirium-orbs", filterClass: null },
  { id: "divination", filterClass: "Divination Cards" },
  { id: "omens", filterClass: null },
  { id: "tattoos", filterClass: null },
  { id: "artifacts", filterClass: null },
];
export const UNIQUE_CATEGORIES = ["unique-weapons", "unique-armours", "unique-accessories", "unique-jewels", "unique-flasks"];

/** Listings below this make a unique's price too thin to set a base's floor. */
export const MIN_LISTINGS = 5;

export interface LootRow {
  category: string;
  row: MarketItemRow;
  tier: Tier;
}

/** Stackables with one value each (variants excluded: a filter can't tell them apart). */
export function stackableTiers(snaps: Record<string, MarketSnapshot>, t: TierThresholds): LootRow[] {
  const out: LootRow[] = [];
  for (const { id } of STACKABLE_CATEGORIES) {
    for (const row of snaps[id]?.items ?? []) {
      if (row.variant !== null) continue;
      out.push({ category: id, row, tier: tierOf(row.value, t) });
    }
  }
  return out.sort((a, b) => b.row.value - a.row.value);
}

export interface UniqueBase {
  baseType: string;
  /** Cheapest well-listed unique on this base: what an unidentified drop is at least worth. */
  floor: number | null;
  /** Most valuable unique on this base. */
  top: MarketItemRow;
  uniques: MarketItemRow[];
  /** Tier by the floor; null floor (only thin listings) → "ignore". */
  tier: Tier;
  /** The best unique on this base reaches the top threshold. */
  chase: boolean;
}

/**
 * Groups priced uniques by base type. Rows with links/variants and thinly
 * listed rows don't set the floor (they'd make a base look better than it is).
 */
export function uniqueBases(snaps: Record<string, MarketSnapshot>, t: TierThresholds): UniqueBase[] {
  const byBase = new Map<string, MarketItemRow[]>();
  for (const cat of UNIQUE_CATEGORIES) {
    for (const row of snaps[cat]?.items ?? []) {
      if (!row.baseType || row.variant !== null) continue;
      byBase.set(row.baseType, [...(byBase.get(row.baseType) ?? []), row]);
    }
  }
  const out: UniqueBase[] = [];
  for (const [baseType, rows] of byBase) {
    const solid = rows.filter((r) => (r.listings ?? 0) >= MIN_LISTINGS);
    const floor = solid.length ? Math.min(...solid.map((r) => r.value)) : null;
    const top = rows.reduce((a, b) => (b.value > a.value ? b : a));
    out.push({
      baseType,
      floor,
      top,
      uniques: [...rows].sort((a, b) => b.value - a.value),
      tier: floor === null ? "ignore" : tierOf(floor, t),
      chase: top.value >= t.top,
    });
  }
  return out.sort((a, b) => (b.floor ?? -1) - (a.floor ?? -1) || b.top.value - a.top.value);
}

// ---------- loot filter ----------

const STYLE: Record<Exclude<Tier, "ignore">, string[]> = {
  top: ["SetFontSize 45", "SetTextColor 255 255 255 255", "SetBorderColor 255 140 40 255", "SetBackgroundColor 140 50 10 255", "PlayEffect Orange", "MinimapIcon 0 Orange Star"],
  valuable: ["SetFontSize 40", "SetTextColor 255 210 160 255", "SetBorderColor 242 140 56 255", "SetBackgroundColor 60 30 15 240", "PlayEffect Yellow", "MinimapIcon 1 Yellow Diamond"],
  pickup: ["SetFontSize 36", "SetBorderColor 200 160 120 200", "MinimapIcon 2 White Circle"],
};

/** Quotes a BaseType name for a filter (names never contain double quotes; drop any defensively). */
const q = (name: string) => `"${name.replace(/"/g, "")}"`;

export interface FilterInput {
  league: string;
  /** Unix ms of the oldest snapshot used. */
  pricesAt: number | null;
  thresholds: TierThresholds;
  stackables: LootRow[];
  bases: UniqueBase[];
  /** Short base-unit label, e.g. "c". */
  unit: string;
}

/**
 * Show-only blocks for the tiers at or above "pick up", meant to be pasted at
 * the top of an existing filter. Nothing is hidden: items below the threshold
 * fall through to the user's own filter rules.
 */
export function lootFilter(f: FilterInput): string {
  const at = f.pricesAt ? new Date(f.pricesAt).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "unknown time";
  const lines = [
    `# Vaalytics · Loot Intelligence · ${f.league} · poe.ninja prices from ${at}`,
    `# Paste above the first rule of your filter. Show-only: nothing is hidden. Regenerate as prices move.`,
    `# Tiers: Top ≥ ${f.thresholds.top}${f.unit} · Valuable ≥ ${f.thresholds.valuable}${f.unit} · Pick up ≥ ${f.thresholds.pickup}${f.unit}`,
    "",
  ];
  for (const tier of TIERS) {
    const styled = STYLE[tier].map((s) => `    ${s}`);
    const names = [...new Set(f.stackables.filter((r) => r.tier === tier).map((r) => r.row.name))];
    if (names.length) lines.push(`Show # Vaalytics ${TIER_LABEL[tier]} — stackables (${names.length})`, `    BaseType == ${names.map(q).join(" ")}`, ...styled, "");
    const bases = f.bases.filter((b) => b.tier === tier).map((b) => b.baseType);
    if (bases.length) lines.push(`Show # Vaalytics ${TIER_LABEL[tier]} — unique bases (${bases.length})`, "    Rarity Unique", `    BaseType == ${bases.map(q).join(" ")}`, ...styled, "");
  }
  return lines.join("\n").trimEnd() + "\n";
}
