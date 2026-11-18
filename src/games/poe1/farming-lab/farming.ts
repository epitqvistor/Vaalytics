/**
 * Farming Lab: the user's own farming sessions. Every number comes from what
 * the user recorded; loot and costs picked from the market keep the unit price
 * used at save time (and its time), so results don't drift with the market.
 * No drop rates. Spec: docs/modules/farming-lab.md
 */
import type { JsonValue } from "@/core/ipc/commands";

/** One cost or loot line, valued in the base unit (chaos). */
export type Line = {
  id: string;
  name: string;
  qty: number;
  /** Chaos per unit used for this session. */
  unitPrice: number;
  /** "market" = poe.ninja price at `pricedAt`; "manual" = value typed by the user. */
  source: "market" | "manual";
  category?: string;
  itemId?: string;
  /** Unix ms of the poe.ninja data the price came from. */
  pricedAt?: number;
};

export type SessionData = { costs: Line[]; loot: Line[]; notes: string };

export type FarmingSession = {
  id: string;
  league: string;
  strategy: string;
  /** Unix seconds. */
  startedAt: number;
  durationSecs: number;
  maps: number;
  data: SessionData;
  savedAt: number;
};

export const lineValue = (l: Line) => l.qty * l.unitPrice;
const sum = (lines: readonly Line[]) => lines.reduce((s, l) => s + lineValue(l), 0);

export interface SessionTotals {
  loot: number;
  cost: number;
  profit: number;
  /** Profit per hour; null without a duration. */
  perHour: number | null;
  /** Profit per map; null without maps. */
  perMap: number | null;
}

export function totals(s: Pick<FarmingSession, "durationSecs" | "maps" | "data">): SessionTotals {
  const loot = sum(s.data.loot);
  const cost = sum(s.data.costs);
  const profit = loot - cost;
  return { loot, cost, profit, perHour: s.durationSecs > 0 ? profit / (s.durationSecs / 3600) : null, perMap: s.maps > 0 ? profit / s.maps : null };
}

export interface StrategySummary {
  strategy: string;
  sessions: number;
  hours: number;
  maps: number;
  profit: number;
  /** Total profit ÷ total hours (pooled, so long sessions weigh more). */
  perHour: number | null;
  perMap: number | null;
  /** Range of per-session profit per hour (spread of your own results). */
  bestPerHour: number | null;
  worstPerHour: number | null;
}

/** Groups sessions by strategy name (case- and space-insensitive), best profit/hour first. */
export function compareStrategies(sessions: readonly FarmingSession[]): StrategySummary[] {
  const groups = new Map<string, FarmingSession[]>();
  for (const s of sessions) {
    const key = s.strategy.trim().replace(/\s+/g, " ").toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out: StrategySummary[] = [];
  for (const list of groups.values()) {
    const t = list.map(totals);
    const hours = list.reduce((h, s) => h + s.durationSecs / 3600, 0);
    const maps = list.reduce((m, s) => m + s.maps, 0);
    const profit = t.reduce((p, x) => p + x.profit, 0);
    const rates = t.map((x) => x.perHour).filter((x): x is number => x !== null);
    out.push({
      strategy: list[0]!.strategy.trim(),
      sessions: list.length,
      hours,
      maps,
      profit,
      perHour: hours > 0 ? profit / hours : null,
      perMap: maps > 0 ? profit / maps : null,
      bestPerHour: rates.length ? Math.max(...rates) : null,
      worstPerHour: rates.length ? Math.min(...rates) : null,
    });
  }
  return out.sort((a, b) => (b.perHour ?? -Infinity) - (a.perHour ?? -Infinity));
}

const isLine = (v: unknown): v is Line => {
  if (!v || typeof v !== "object") return false;
  const l = v as Record<string, unknown>;
  return (
    typeof l.id === "string" &&
    typeof l.name === "string" &&
    typeof l.qty === "number" &&
    Number.isFinite(l.qty) &&
    l.qty >= 0 &&
    typeof l.unitPrice === "number" &&
    Number.isFinite(l.unitPrice) &&
    l.unitPrice >= 0 &&
    (l.source === "market" || l.source === "manual")
  );
};

/** Sessions from the database are only shown when their data has the expected shape. */
export function isSession(v: unknown): v is FarmingSession {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  const d = s.data as Record<string, unknown> | null;
  return (
    typeof s.id === "string" &&
    typeof s.strategy === "string" &&
    typeof s.durationSecs === "number" &&
    typeof s.maps === "number" &&
    !!d &&
    Array.isArray(d.loot) &&
    d.loot.every(isLine) &&
    Array.isArray(d.costs) &&
    d.costs.every(isLine) &&
    typeof d.notes === "string"
  );
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Session data as JSON for the host. */
export const toJson = (d: SessionData) => d as unknown as JsonValue;

/** "1 h 05 min" */
export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}
