/**
 * Price alerts: user rules checked against cached market data whenever it is
 * loaded or refreshed while Vaalytics is open. No polling of their own, no OS
 * notifications (yet). Stored per game (`market.alerts`).
 */
import type { MarketItemRow } from "@/core/ipc/commands";

// A type alias (not an interface) so it is assignable to the JSON setting type.
export type AlertRule = {
  id: string;
  category: string;
  itemId: string;
  /** Name when created (shown if the item disappears from the market). */
  name: string;
  op: "above" | "below";
  threshold: number;
  /** Currency id the threshold is in (base unit or any currency with a rate). */
  unit: string;
  createdAt: number;
};

export type AlertState =
  | { status: "triggered"; current: number }
  | { status: "waiting"; current: number }
  /** Item not in the loaded data (category not loaded yet, or delisted). */
  | { status: "missing" }
  /** No rate for the threshold currency. */
  | { status: "no-rate" };

/** `toUnit(base, unitId)` converts a base amount; returns null without a rate. */
export function evaluateAlert(rule: AlertRule, row: MarketItemRow | undefined, toUnit: (base: number, unit: string) => number | null): AlertState {
  if (!row) return { status: "missing" };
  const current = toUnit(row.value, rule.unit);
  if (current === null) return { status: "no-rate" };
  const hit = rule.op === "above" ? current >= rule.threshold : current <= rule.threshold;
  return { status: hit ? "triggered" : "waiting", current };
}

export const MAX_ALERTS = 100;

export function isAlertList(v: unknown): v is AlertRule[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_ALERTS &&
    v.every((r) => {
      if (!r || typeof r !== "object") return false;
      const a = r as Record<string, unknown>;
      return (
        typeof a.id === "string" &&
        typeof a.category === "string" &&
        typeof a.itemId === "string" &&
        typeof a.name === "string" &&
        (a.op === "above" || a.op === "below") &&
        typeof a.threshold === "number" &&
        Number.isFinite(a.threshold) &&
        a.threshold >= 0 &&
        typeof a.unit === "string" &&
        typeof a.createdAt === "number"
      );
    })
  );
}

export function addAlert(list: readonly AlertRule[], rule: Omit<AlertRule, "id" | "createdAt">, now = Date.now()): AlertRule[] {
  if (list.length >= MAX_ALERTS) return [...list];
  return [...list, { ...rule, id: `${rule.category}:${rule.itemId}:${now}`, createdAt: now }];
}
