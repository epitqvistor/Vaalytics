import { describe, expect, it } from "vitest";
import type { LootItem, SessionSummary } from "@/core/ipc/commands";
import { byCategory, bySession, capturedSince, dailyCaptures, lootTotals } from "./stats";

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
