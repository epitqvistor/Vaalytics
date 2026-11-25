import { describe, expect, it } from "vitest";
import type { LootItem, SessionSummary } from "@/core/ipc/commands";
import type { LootMapRun } from "@/core/ipc/commands";
import { byCategory, bySession, capturedSince, currencyDistribution, dailyCaptures, lootTotals, mapDuration, mapStats, weekComparison } from "./stats";

const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime() / 1000;

function item(id: number, over: Partial<LootItem> = {}): LootItem {
  return {
    id,
    fingerprint: `f${id}`,
    itemClass: "Stackable Currency",
    rarity: "Currency",
    itemName: null,
    baseType: "Exalted Orb",
    category: "currency",
    icon: null,
    itemLevel: null,
    stackSize: 1,
    quality: null,
    corrupted: false,
    unidentified: false,
    parserConfidence: "high",
    parserWarnings: [],
    capturedAt: local(2026, 11, 17),
    lastCapturedAt: local(2026, 11, 17),
    captureCount: 1,
    source: "clipboard",
    sessionId: null,
    captureAreaName: null,
    captureAreaKind: null,
    sessionElapsedSecs: null,
    originStatus: "unknown",
    originNote: null,
    status: "captured",
    favorite: false,
    notes: null,
    tags: [],
    valueStatus: "priced",
    valueTotal: 1,
    valueCheckedAt: null,
    valueSource: null,
    valueConfidence: null,
    valueFetchedAt: null,
    valueLeague: null,
    valueAtCapture: null,
    mapRunId: null,
    mapAssignment: null,
    verified: false,
    originalCategory: null,
    originalStackSize: null,
    valueNote: null,
    ...over,
  };
}

describe("loot stats", () => {
  it("totals count only known values and keep unpriced items separate", () => {
    const t = lootTotals([
      item(1, { valueTotal: 3 }),
      item(2, { rarity: "Rare", category: "accessory", valueStatus: "unsupported", valueTotal: null }),
      item(3, { rarity: "Unique", category: "unique", valueStatus: "manual", valueTotal: 50 }),
      item(4, { valueStatus: "no_market_data", valueTotal: null }),
    ]);
    expect(t).toMatchObject({ items: 4, value: 53, valued: 2, unpriced: 2, uniques: 1 });
    expect(t.mostValuable?.id).toBe(3);
    expect(t.topCategory).toEqual({ category: "currency", count: 2 });
    expect(lootTotals([]).mostValuable).toBeNull();
  });

  it("groups by category and by session with rates", () => {
    expect(byCategory([item(1), item(2), item(3, { category: "waystone", valueStatus: "unsupported", valueTotal: null })])[0]).toEqual({ category: "currency", count: 2, value: 2 });
    const session = { id: 9, startedAt: 100, durationSecs: 7200 } as SessionSummary;
    const r = bySession([item(1, { sessionId: 9, valueTotal: 10 }), item(2, { sessionId: 9, valueStatus: "unsupported", valueTotal: null }), item(3)], [session]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ sessionId: 9, items: 2, value: 10, unpriced: 1, perHour: 1, valuePerHour: 5 });
    expect(bySession([item(1, { sessionId: 5 })], [])[0]!.perHour).toBeNull();
  });

  it("buckets captures per local day", () => {
    const days = dailyCaptures([item(1, { capturedAt: local(2026, 11, 16) }), item(2), item(3, { valueStatus: "unsupported", valueTotal: null })], 3, local(2026, 11, 17) * 1000);
    expect(days.map((d) => d.count)).toEqual([0, 1, 2]);
    expect(days.map((d) => d.value)).toEqual([0, 1, 1]);
    expect(capturedSince([item(1), item(2, { capturedAt: local(2026, 11, 1) })], local(2026, 11, 17, 0) * 1000)).toBe(1);
  });
});

function run(id: number, over: Partial<LootMapRun> = {}): LootMapRun {
  return {
    id,
    sessionId: 1,
    source: "auto",
    areaId: "MapA",
    areaName: "Razed Fields",
    areaLevel: 79,
    seed: id,
    startedAt: 1000,
    endedAt: 2000,
    status: "finished",
    strategy: null,
    notes: null,
    userConfirmed: false,
    durationSecs: 600,
    runningSince: null,
    ordinal: id,
    items: 1,
    quantity: 1,
    itemTypes: 1,
    value: 0,
    unpriced: 0,
    bestItemId: null,
    bestItemName: null,
    bestItemValue: null,
    bestItemIcon: null,
    ...over,
  };
}

describe("loot stats (rework)", () => {
  it("counts quantity and the average of priced items only", () => {
    const t = lootTotals([item(1, { stackSize: 20, valueTotal: 4 }), item(2, { stackSize: null, valueTotal: 2 }), item(3, { valueStatus: "no_market_data", valueTotal: null })]);
    expect(t.quantity).toBe(22);
    expect(t.average).toBe(3);
    expect(lootTotals([]).average).toBeNull();
  });

  it("groups stackables by type, most valuable first, unpriced counted apart", () => {
    const d = currencyDistribution([
      item(1, { baseType: "Exalted Orb", stackSize: 3, valueTotal: 3 }),
      item(2, { baseType: "Exalted Orb", stackSize: 2, valueTotal: 2 }),
      item(3, { baseType: "Divine Orb", stackSize: 1, valueTotal: 300 }),
      item(4, { baseType: "Odd Orb", valueStatus: "no_market_data", valueTotal: null }),
      item(5, { baseType: "Sapphire Ring", category: "accessory", rarity: "Rare", valueTotal: 50 }),
    ]);
    expect(d.map((x) => [x.name, x.quantity, x.value, x.unpriced])).toEqual([
      ["Divine Orb", 1, 300, 0],
      ["Exalted Orb", 5, 5, 0],
      ["Odd Orb", 1, 0, 1],
    ]);
  });

  it("compares this week with the previous one", () => {
    const now = new Date(2026, 10, 18, 12).getTime(); // Wed 18 Nov 2026
    const w = weekComparison([item(1, { capturedAt: local(2026, 11, 17), valueTotal: 6 }), item(2, { capturedAt: local(2026, 11, 10), valueTotal: 3 }), item(3, { capturedAt: local(2026, 11, 1) })], now);
    expect(w.current).toEqual({ items: 1, value: 6 });
    expect(w.previous).toEqual({ items: 1, value: 3 });
    expect(w.valueChange).toBe(1);
    expect(weekComparison([], now).valueChange).toBeNull();
  });

  it("map stats skip open and very short maps", () => {
    const s = mapStats([
      run(1, { value: 10, durationSecs: 600 }),
      run(2, { value: 2, durationSecs: 600 }),
      run(3, { value: 99, durationSecs: 20 }),
      run(4, { value: 50, status: "active", endedAt: null }),
    ]);
    expect([s.maps, s.counted, s.totalValue, s.averageValue, s.averageSecs]).toEqual([4, 2, 12, 6, 600]);
    expect(s.valuePerHour).toBe(36);
    expect([s.best?.id, s.worst?.id]).toEqual([1, 2]);
    expect(mapStats([run(1, { value: 1 })]).worst).toBeNull();
  });

  it("a running map's clock advances from runningSince", () => {
    expect(mapDuration(run(1, { durationSecs: 100, runningSince: 900 }), 1000)).toBe(100);
    expect(mapDuration(run(1, { durationSecs: 100, runningSince: 900 }), 1060)).toBe(160);
    expect(mapDuration(run(1, { durationSecs: 100 }), 5000)).toBe(100);
  });
});
