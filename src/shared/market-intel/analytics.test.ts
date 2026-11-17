import { describe, expect, it } from "vitest";
import type { MarketItemRow, MarketSnapshot } from "@/core/ipc/commands";
import { addAlert, evaluateAlert, isAlertList, type AlertRule } from "./alerts";
import { categoryStats, liquidityOf, liquidityRanking, movers, weightedMedian, type CategorizedRow } from "./analytics";

const row = (itemId: string, value: number, change7d: number | null, liq: { volume?: number; listings?: number } = {}): MarketItemRow => ({
  itemId,
  name: itemId,
  variant: null,
  icon: null,
  value,
  divineValue: null,
  change7d,
  sparkline: [],
  volumeValue: liq.volume ?? null,
  listings: liq.listings ?? null,
});
const snap = (items: MarketItemRow[]): MarketSnapshot => ({
  category: "c",
  baseUnit: "chaos",
  source: "poe.ninja",
  items,
  fetchedAt: 1_700_000_000,
  expiresAt: null,
  lastError: null,
  lastErrorAt: null,
  refreshing: false,
});

describe("liquidity and medians", () => {
  it("uses traded value, else listings", () => {
    expect(liquidityOf(row("a", 1, 0, { volume: 50, listings: 3 }))).toEqual({
      kind: "traded",
      value: 50,
    });
    expect(liquidityOf(row("a", 1, 0, { listings: 3 }))).toEqual({
      kind: "listings",
      value: 3,
    });
    expect(liquidityOf(row("a", 1, 0))).toBeNull();
  });

  it("weighted median ignores a thin outlier", () => {
    expect(weightedMedian([0.1, 0.12, 54.3], [1000, 900, 1])).toBe(0.1);
    expect(weightedMedian([], [])).toBeNull();
  });
});

describe("category stats", () => {
  it("summarises liquidity, change and breadth", () => {
    const s = categoryStats(
      "currency",
      "Currency",
      snap([
        row("divine", 155, 0.2, { volume: 9000 }),
        row("exalt", 0.8, -0.1, { volume: 400 }),
        row("odd", 2, 50, { volume: 1 }),
        row("flat", 1, 0.001, { volume: 10 }),
      ]),
    );
    expect(s.liquidityKind).toBe("traded");
    expect(s.liquidity).toBe(9411);
    expect(s.change7d).toBe(0.2); // dominated by the liquid item, not the +5000 % one
    expect([s.risers, s.fallers]).toEqual([2, 1]);
    expect(s.leader?.itemId).toBe("divine");
  });

  it("item categories use listings", () => {
    const s = categoryStats("uniques", "Uniques", snap([row("a", 10, 0.1, { listings: 40 }), row("b", 5, -0.2, { listings: 4 })]));
    expect(s.liquidityKind).toBe("listings");
    expect(s.liquidity).toBe(44);
  });
});

describe("movers", () => {
  const rows: CategorizedRow[] = [
    // Liquid half of currency (median 3000): big-up, down, cheap.
    { category: "currency", row: row("big-up", 10, 0.5, { volume: 4000 }) },
    { category: "currency", row: row("thin-up", 10, 9, { volume: 1 }) },
    { category: "currency", row: row("down", 10, -0.4, { volume: 3000 }) },
    { category: "currency", row: row("cheap", 0.01, 3, { volume: 5000 }) },
    { category: "currency", row: row("flat", 10, 0, { volume: 1000 }) },
    { category: "uniques", row: row("u", 50, 0.3, { listings: 20 }) },
    { category: "uniques", row: row("u2", 50, 0.9, { listings: 2 }) },
  ];

  it("filters by liquidity per category, value and direction", () => {
    const up = movers(rows, {
      direction: "up",
      liquidOnly: true,
      minValue: 0.1,
      limit: 10,
    }).map((r) => r.row.itemId);
    expect(up).toEqual(["big-up", "u"]);
    const down = movers(rows, {
      direction: "down",
      liquidOnly: true,
      minValue: 0,
      limit: 10,
    }).map((r) => r.row.itemId);
    expect(down).toEqual(["down"]);
    const all = movers(rows, {
      direction: "both",
      liquidOnly: false,
      minValue: 0,
      limit: 3,
    }).map((r) => r.row.itemId);
    expect(all).toEqual(["thin-up", "cheap", "u2"]);
  });
});

describe("liquidity ranking", () => {
  it("ranks by the category's measure with shares", () => {
    const r = liquidityRanking(
      "currency",
      snap([row("a", 1, 0, { volume: 300 }), row("b", 1, 0, { volume: 100 }), row("c", 1, 0, { listings: 999 })]),
      10,
    );
    expect(r.map((x) => [x.row.itemId, x.share])).toEqual([
      ["a", 0.75],
      ["b", 0.25],
    ]);
  });
});

describe("alerts", () => {
  const rule: AlertRule = {
    id: "x",
    category: "currency",
    itemId: "divine",
    name: "Divine Orb",
    op: "above",
    threshold: 1,
    unit: "mirror",
    createdAt: 0,
  };
  const rates: Record<string, number> = { chaos: 1, mirror: 100 };
  const toUnit = (v: number, u: string) => (rates[u] ? v / rates[u]! : null);

  it("evaluates in the threshold's currency", () => {
    expect(evaluateAlert(rule, row("divine", 150, 0), toUnit)).toEqual({
      status: "triggered",
      current: 1.5,
    });
    expect(evaluateAlert({ ...rule, op: "below" }, row("divine", 150, 0), toUnit)).toEqual({ status: "waiting", current: 1.5 });
    expect(evaluateAlert(rule, undefined, toUnit)).toEqual({
      status: "missing",
    });
    expect(evaluateAlert({ ...rule, unit: "exalted" }, row("divine", 150, 0), toUnit)).toEqual({ status: "no-rate" });
  });

  it("validates stored rules", () => {
    const list = addAlert(
      [],
      {
        category: "currency",
        itemId: "divine",
        name: "Divine Orb",
        op: "below",
        threshold: 140,
        unit: "chaos",
      },
      5,
    );
    expect(isAlertList(list)).toBe(true);
    expect(isAlertList([{ ...list[0], threshold: -1 }])).toBe(false);
    expect(isAlertList([{ ...list[0], op: "near" }])).toBe(false);
  });
});
