import { describe, expect, it } from "vitest";
import type { MarketItemRow } from "@/core/ipc/commands";
import { biggestMovers, defaultLeague, favoriteKey, parseFavoriteKey, trendValues } from "./derive";

const L = (name: string, hardcore = false, indexed = true) => ({ name, displayName: name, hardcore, indexed });

describe("defaultLeague", () => {
  it("prefers an indexed softcore challenge league", () => {
    expect(defaultLeague([L("Forbidden Rites", false, false), L("Runes of Aldur"), L("HC Runes of Aldur", true), L("Standard")])).toBe("Runes of Aldur");
  });
  it("falls back sensibly", () => {
    expect(defaultLeague([L("Standard"), L("Hardcore", true)])).toBe("Standard");
    expect(defaultLeague([L("Hardcore", true)])).toBe("Hardcore");
    expect(defaultLeague([])).toBeNull();
  });
});

describe("trendValues", () => {
  it("reconstructs values ending at the current value", () => {
    const pts = trendValues({ value: 110, sparkline: [null, 0, 5, 10] });
    expect(pts.map((p) => p.daysAgo)).toEqual([2, 1, 0]);
    expect(pts[0]!.value).toBeCloseTo(100);
    expect(pts[1]!.value).toBeCloseTo(105);
    expect(pts[2]!.value).toBeCloseTo(110);
  });
  it("rejects unusable series", () => {
    expect(trendValues({ value: 1, sparkline: [] })).toEqual([]);
    expect(trendValues({ value: 1, sparkline: [1, null] })).toEqual([]);
    expect(trendValues({ value: 1, sparkline: [-100, -100] })).toEqual([]);
  });
});

describe("favorites", () => {
  it("round-trips keys, including ids with colons", () => {
    expect(parseFavoriteKey(favoriteKey("currency", "divine"))).toEqual({ category: "currency", itemId: "divine" });
    expect(parseFavoriteKey("maps:a:b")).toEqual({ category: "maps", itemId: "a:b" });
    expect(parseFavoriteKey("bad")).toBeNull();
  });
});

describe("biggestMovers", () => {
  const row = (id: string, change: number | null, volume: number): MarketItemRow => ({
    itemId: id, name: id, variant: null, icon: null, value: 1, divineValue: null, change7d: change, sparkline: [], volumeValue: volume, listings: null,
  });
  it("ignores illiquid items and sorts by absolute change", () => {
    const m = biggestMovers([row("thin", 5, 1), row("a", 0.1, 100), row("b", -0.4, 200), row("c", 0.2, 150), row("none", null, 999)], 2);
    expect(m.map((r) => r.itemId)).toEqual(["b", "c"]);
  });
});
