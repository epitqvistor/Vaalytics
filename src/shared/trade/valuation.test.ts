import { describe, expect, it } from "vitest";
import { outlierFences, valuate, weightedMedian, type ValuationListing } from "./valuation";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const fresh = new Date(NOW - 3_600_000).toISOString();
const list = (prices: (number | null)[], extra: Partial<ValuationListing> = {}): ValuationListing[] =>
  prices.map((p, i) => ({ id: `l${i}`, amountBase: p, indexed: fresh, match: 1, ...extra }));

describe("valuation engine", () => {
  it("treats a far higher price as an outlier and values the cluster (brief example)", () => {
    const v = valuate({ listings: list([5, 8, 9, 10, 11, 12, 15, 80]), total: 8, basis: "stats", now: NOW });
    expect(v.verdicts.get("l7")).toBe("high-outlier");
    expect(v.highOutliers).toBe(1);
    expect(v.used).toBe(7);
    expect(v.estimate).toBe(10);
    expect(v.lowest).toBe(5);
    expect(v.median).toBe(10);
    // 7 listings is not "many": medium at best.
    expect(v.confidence).toBe("medium");
  });

  it("flags bait listings far below the cluster", () => {
    const v = valuate({ listings: list([1, 40, 42, 45, 45, 48, 50, 52, 55]), total: 120, basis: "stats", now: NOW });
    expect(v.verdicts.get("l0")).toBe("low-outlier");
    expect(v.lowest).toBe(40);
    expect(v.confidence).toBe("high");
  });

  it("cheap markets: 1 c among 2–3 c is a price, 0.14 c (1 alch) is bait (real Covens boots, Nov 2026)", () => {
    const prices = [0.14, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4];
    const v = valuate({ listings: list(prices), total: 415, basis: "exact", now: NOW });
    expect(v.verdicts.get("l0")).toBe("low-outlier");
    expect([1, 2, 3].map((i) => v.verdicts.get(`l${i}`))).toEqual(["used", "used", "used"]);
    expect(v.lowest).toBe(1);
  });

  it("does not call normal prices outliers in a tight cluster", () => {
    const v = valuate({ listings: list([9, 10, 10, 10, 10, 10, 11, 12]), total: 50, basis: "exact", now: NOW });
    expect(v.lowOutliers + v.highOutliers).toBe(0);
  });

  it("base type only never gets a confidence grade, however many listings", () => {
    const v = valuate({ listings: list(Array.from({ length: 20 }, () => 1)), total: 5000, basis: "base", now: NOW });
    expect(v.confidence).toBe("base-only");
    expect(v.reasons[0]).toMatch(/base type only/);
  });

  it("refuses an estimate with fewer than 3 usable prices", () => {
    const v = valuate({ listings: list([20, null, 25]), total: 3, basis: "stats", now: NOW });
    expect(v.confidence).toBe("insufficient");
    expect(v.estimate).toBeNull();
    expect(v.noPrice).toBe(1);
    expect(v.verdicts.get("l1")).toBe("no-price");
    expect(v.lowest).toBe(20);
  });

  it("reports unpriced when nothing matches or nothing converts", () => {
    expect(valuate({ listings: [], total: 0, basis: "stats", now: NOW }).confidence).toBe("unpriced");
    expect(valuate({ listings: list([null, null]), total: 2, basis: "exact", now: NOW }).confidence).toBe("unpriced");
  });

  it("caps confidence for poor matches, unsearchable mods and stale listings", () => {
    const tight = [10, 10, 10, 11, 11, 11, 12, 12, 12, 12];
    expect(valuate({ listings: list(tight), total: 300, basis: "stats", now: NOW }).confidence).toBe("high");
    expect(valuate({ listings: list(tight, { match: 0.5 }), total: 300, basis: "stats", now: NOW }).confidence).toBe("medium");
    expect(valuate({ listings: list(tight), total: 300, basis: "stats", unsearchedMods: 2, now: NOW }).confidence).toBe("medium");
    const old = new Date(NOW - 20 * 86_400_000).toISOString();
    expect(valuate({ listings: list(tight, { indexed: old }), total: 300, basis: "stats", now: NOW }).confidence).toBe("medium");
    expect(valuate({ listings: list([10, 10, 11, 11]), total: 4, basis: "exact", now: NOW }).confidence).toBe("low");
  });

  it("wide price spread lowers confidence", () => {
    const v = valuate({ listings: list([5, 8, 12, 20, 30, 45, 60, 80, 100]), total: 200, basis: "exact", now: NOW });
    expect(v.confidence).toBe("low");
  });

  it("weights better-matching listings more", () => {
    expect(weightedMedian([{ v: 10, w: 1 }, { v: 20, w: 1 }, { v: 30, w: 3 }])).toBe(30);
    const ls: ValuationListing[] = [
      { id: "a", amountBase: 10, match: 0, indexed: fresh },
      { id: "b", amountBase: 11, match: 0, indexed: fresh },
      { id: "c", amountBase: 12, match: 1, indexed: fresh },
      { id: "d", amountBase: 13, match: 1, indexed: fresh },
      { id: "e", amountBase: 14, match: 1, indexed: fresh },
    ];
    expect(valuate({ listings: ls, total: 5, basis: "stats", now: NOW }).estimate).toBe(12);
  });

  it("outlier fences need at least 3 prices", () => {
    expect(outlierFences([1, 100])).toEqual({ low: 0, high: Infinity });
  });
});
