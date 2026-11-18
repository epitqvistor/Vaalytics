/**
 * Loot Journal analytics over captured items. Pure functions, no I/O.
 * Everything here describes CAPTURED items (copied in game), never all loot:
 * no profit is derived from it. Spec: docs/modules/loot-journal.md
 */
import type { LootItem, LootValueStatus, SessionSummary } from "@/core/ipc/commands";

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
  let best: LootItem | null = null;
  const byCat = new Map<string, number>();
  for (const i of items) {
    if (isValued(i)) {
      value += i.valueTotal!;
      valued++;
      if (!best || i.valueTotal! > best.valueTotal!) best = i;
    }
    if (i.rarity === "Unique") uniques++;
    byCat.set(i.category, (byCat.get(i.category) ?? 0) + 1);
  }
  let top: LootTotals["topCategory"] = null;
  for (const [category, count] of byCat) if (!top || count > top.count) top = { category, count };
  return { items: items.length, value, valued, unpriced: items.length - valued, uniques, mostValuable: best, topCategory: top };
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
