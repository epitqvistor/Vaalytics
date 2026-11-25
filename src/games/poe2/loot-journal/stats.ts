/**
 * Loot Journal analytics over captured items. Pure functions, no I/O.
 * Everything here describes CAPTURED items (copied in game), never all loot:
 * no profit is derived from it. Spec: docs/modules/loot-journal.md
 */
import type { LootItem, LootMapRun, LootValueStatus, SessionSummary } from "@/core/ipc/commands";

export const CATEGORY_LABEL: Record<string, string> = {
  currency: "Currency",
  socketable: "Runes & soul cores",
  omen: "Omens",
  fragment: "Fragments",
  weapon: "Weapons",
  armour: "Armour",
  accessory: "Accessories",
  flask: "Flasks & charms",
  jewel: "Jewels",
  relic: "Relics",
  unique: "Uniques",
  skill_gem: "Skill gems",
  support_gem: "Support gems",
  waystone: "Waystones",
  tablet: "Tablets",
  other: "Other",
};
export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c;

export const VALUE_STATUS_LABEL: Record<LootValueStatus, string> = {
  pending: "Pricing…",
  priced: "Priced",
  unsupported: "Manual valuation required",
  no_market_data: "Insufficient market data",
  manual: "Your value",
};

/** Compact labels for tables (full text in VALUE_STATUS_LABEL). */
export const VALUE_STATUS_SHORT: Record<LootValueStatus, string> = {
  pending: "Pricing…",
  priced: "Priced",
  unsupported: "Manual value",
  no_market_data: "No market data",
  manual: "Your value",
};

/** Items whose value is known (market or the user's own). */
export const isValued = (i: Pick<LootItem, "valueStatus" | "valueTotal">) => (i.valueStatus === "priced" || i.valueStatus === "manual") && i.valueTotal !== null;

export interface LootTotals {
  items: number;
  /** Sum of stack sizes (an item without a stack counts once). */
  quantity: number;
  /** Mean known value per priced item; null without priced items. */
  average: number | null;
  /** Sum of known values (base unit). */
  value: number;
  valued: number;
  unpriced: number;
  uniques: number;
  mostValuable: LootItem | null;
  topCategory: { category: string; count: number } | null;
}

export function lootTotals(items: readonly LootItem[]): LootTotals {
  let value = 0;
  let valued = 0;
  let uniques = 0;
  let quantity = 0;
  let best: LootItem | null = null;
  const byCat = new Map<string, number>();
  for (const i of items) {
    if (isValued(i)) {
      value += i.valueTotal!;
      valued++;
      if (!best || i.valueTotal! > best.valueTotal!) best = i;
    }
    if (i.rarity === "Unique") uniques++;
    quantity += quantityOf(i);
    byCat.set(i.category, (byCat.get(i.category) ?? 0) + 1);
  }
  let top: LootTotals["topCategory"] = null;
  for (const [category, count] of byCat) if (!top || count > top.count) top = { category, count };
  return { items: items.length, quantity, average: valued ? value / valued : null, value, valued, unpriced: items.length - valued, uniques, mostValuable: best, topCategory: top };
}

export function byCategory(items: readonly LootItem[]): { category: string; count: number; value: number }[] {
  const m = new Map<string, { count: number; value: number }>();
  for (const i of items) {
    const e = m.get(i.category) ?? { count: 0, value: 0 };
    e.count++;
    if (isValued(i)) e.value += i.valueTotal!;
    m.set(i.category, e);
  }
  return [...m.entries()].map(([category, e]) => ({ category, ...e })).sort((a, b) => b.count - a.count || b.value - a.value);
}

export interface SessionLoot {
  sessionId: number;
  session: SessionSummary | null;
  items: number;
  value: number;
  unpriced: number;
  mostValuable: LootItem | null;
  perHour: number | null;
  valuePerHour: number | null;
}

/** Captured items grouped by the session they were copied in (newest session first). */
export function bySession(items: readonly LootItem[], sessions: readonly SessionSummary[]): SessionLoot[] {
  const groups = new Map<number, LootItem[]>();
  for (const i of items) if (i.sessionId !== null) groups.set(i.sessionId, [...(groups.get(i.sessionId) ?? []), i]);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  return [...groups.entries()]
    .map(([sessionId, list]) => {
      const t = lootTotals(list);
      const s = byId.get(sessionId) ?? null;
      const hours = s && s.durationSecs >= 300 ? s.durationSecs / 3600 : null;
      return {
        sessionId,
        session: s,
        items: t.items,
        value: t.value,
        unpriced: t.unpriced,
        mostValuable: t.mostValuable,
        perHour: hours ? t.items / hours : null,
        valuePerHour: hours ? t.value / hours : null,
      };
    })
    .sort((a, b) => (b.session?.startedAt ?? 0) - (a.session?.startedAt ?? 0) || b.sessionId - a.sessionId);
}

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export const capturedSince = (items: readonly LootItem[], fromMs: number) => items.filter((i) => i.capturedAt * 1000 >= fromMs).length;

/** Count and known value of captures per local day, oldest first. */
export function dailyCaptures(items: readonly LootItem[], days: number, nowMs: number) {
  const today = startOfDay(nowMs);
  return Array.from({ length: days }, (_, k) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - k));
    const start = d.getTime();
    const e = new Date(start);
    e.setDate(e.getDate() + 1);
    const inDay = items.filter((i) => i.capturedAt * 1000 >= start && i.capturedAt * 1000 < e.getTime());
    return {
      startMs: start,
      label: d.toLocaleDateString("en-GB", { month: "short", day: "numeric" }),
      count: inDay.length,
      value: inDay.reduce((a, i) => a + (isValued(i) ? i.valueTotal! : 0), 0),
    };
  });
}

export const displayName = (i: Pick<LootItem, "itemName" | "baseType">) => i.itemName ?? i.baseType;

/** Stack size of one capture (1 for items without a stack). */
export const quantityOf = (i: Pick<LootItem, "stackSize">) => Math.max(1, i.stackSize ?? 1);

/** Stackable kinds shown in the currency distribution. */
const STACKABLE = new Set(["currency", "socketable", "omen", "fragment"]);

/** Value and quantity per stackable item type (Exalted Orb, Perfect Essence of …), most valuable first. */
export function currencyDistribution(items: readonly LootItem[], limit = 10) {
  const m = new Map<string, { name: string; icon: string | null; quantity: number; value: number; unpriced: number }>();
  for (const i of items) {
    if (!STACKABLE.has(i.category)) continue;
    const e = m.get(i.baseType) ?? { name: i.baseType, icon: i.icon, quantity: 0, value: 0, unpriced: 0 };
    e.quantity += quantityOf(i);
    if (isValued(i)) e.value += i.valueTotal!;
    else e.unpriced++;
    e.icon ??= i.icon;
    m.set(i.baseType, e);
  }
  return [...m.values()].sort((a, b) => b.value - a.value || b.quantity - a.quantity).slice(0, limit);
}

/** Captures and known value this week vs the week before (local weeks starting Monday). */
export function weekComparison(items: readonly LootItem[], nowMs: number) {
  const thisWeek = startOfWeek(nowMs);
  const d = new Date(thisWeek);
  d.setDate(d.getDate() - 7);
  const lastWeek = d.getTime();
  const sum = (from: number, to: number) => {
    const inRange = items.filter((i) => i.capturedAt * 1000 >= from && i.capturedAt * 1000 < to);
    return { items: inRange.length, value: inRange.reduce((a, i) => a + (isValued(i) ? i.valueTotal! : 0), 0) };
  };
  const cur = sum(thisWeek, Number.POSITIVE_INFINITY);
  const prev = sum(lastWeek, thisWeek);
  const change = (a: number, b: number) => (b > 0 ? (a - b) / b : null);
  return { current: cur, previous: prev, itemsChange: change(cur.items, prev.items), valueChange: change(cur.value, prev.value) };
}

/** Running duration of a map record at `nowSecs` (the clock only advances while it is counting). */
export const mapDuration = (m: Pick<LootMapRun, "durationSecs" | "runningSince">, nowSecs: number) =>
  m.runningSince !== null ? Math.max(m.durationSecs, nowSecs - m.runningSince) : m.durationSecs;

/** Map records shorter than this are left out of per-map averages (a portal in and straight out). */
export const MIN_MAP_SECS = 60;

export interface MapStats {
  maps: number;
  /** Maps long enough to count in averages. */
  counted: number;
  totalValue: number;
  averageValue: number | null;
  averageSecs: number | null;
  /** Known captured value per hour spent in maps. */
  valuePerHour: number | null;
  best: LootMapRun | null;
  worst: LootMapRun | null;
}

export function mapStats(maps: readonly LootMapRun[]): MapStats {
  const counted = maps.filter((m) => m.status === "finished" && m.durationSecs >= MIN_MAP_SECS);
  const totalValue = counted.reduce((a, m) => a + m.value, 0);
  const secs = counted.reduce((a, m) => a + m.durationSecs, 0);
  const byValue = [...counted].sort((a, b) => b.value - a.value);
  return {
    maps: maps.length,
    counted: counted.length,
    totalValue,
    averageValue: counted.length ? totalValue / counted.length : null,
    averageSecs: counted.length ? secs / counted.length : null,
    valuePerHour: secs >= 600 ? totalValue / (secs / 3600) : null,
    best: byValue[0] ?? null,
    worst: byValue.length > 1 ? byValue[byValue.length - 1]! : null,
  };
}

/** Name shown for a map record. */
export const mapName = (m: Pick<LootMapRun, "areaName" | "areaId" | "source">) => m.areaName ?? m.areaId ?? (m.source === "manual" ? "Manual map" : "Unknown map");
