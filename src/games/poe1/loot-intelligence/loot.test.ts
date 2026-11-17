import { describe, expect, it } from "vitest";
import type { MarketItemRow, MarketSnapshot } from "@/core/ipc/commands";
import { DEFAULT_THRESHOLDS, isThresholds, lootFilter, stackableTiers, tierOf, uniqueBases } from "./loot";

const row = (name: string, value: number, extra: Partial<MarketItemRow> = {}): MarketItemRow => ({
  itemId: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  variant: null,
  icon: null,
  value,
  divineValue: null,
  change7d: null,
  sparkline: [],
  volumeValue: null,
  listings: 50,
  baseType: null,
  ...extra,
});
const snap = (items: MarketItemRow[]): MarketSnapshot => ({ category: "x", baseUnit: "chaos", source: "poe.ninja", items, fetchedAt: 1, expiresAt: null, lastError: null, lastErrorAt: null, refreshing: false });

describe("tiers", () => {
  it("classifies by thresholds and validates stored thresholds", () => {
    expect([150, 50, 2, 0.5].map((v) => tierOf(v, DEFAULT_THRESHOLDS))).toEqual(["top", "valuable", "pickup", "ignore"]);
    expect(isThresholds({ top: 100, valuable: 10, pickup: 1 })).toBe(true);
    expect(isThresholds({ top: 5, valuable: 10, pickup: 1 })).toBe(false);
    expect(isThresholds({ top: 100, valuable: 10, pickup: -1 })).toBe(false);
  });

  it("stackables skip variants and sort by value", () => {
    const r = stackableTiers({ currency: snap([row("Chaos Orb", 1), row("Divine Orb", 155)]), fragments: snap([row("Sacred Crystal", 5, { variant: "x" })]) }, DEFAULT_THRESHOLDS);
    expect(r.map((x) => [x.row.name, x.tier])).toEqual([
      ["Divine Orb", "top"],
      ["Chaos Orb", "pickup"],
    ]);
  });
});

describe("unique bases", () => {
  const snaps = {
    "unique-accessories": snap([
      row("Headhunter", 9000, { baseType: "Leather Belt" }),
      row("Wurm's Molt", 2, { baseType: "Leather Belt" }),
      row("Thin Rare", 400, { baseType: "Ruby Ring", listings: 1 }),
      row("Six Link", 900, { baseType: "Leather Belt", variant: "6L" }),
    ]),
    "unique-armours": snap([row("Kaom's Heart", 40, { baseType: "Glorious Plate" }), row("Lioneye's Vision", 30, { baseType: "Glorious Plate" })]),
  };
  const bases = uniqueBases(snaps, DEFAULT_THRESHOLDS);

  it("floor = cheapest well-listed unique; chase = best reaches top", () => {
    const belt = bases.find((b) => b.baseType === "Leather Belt")!;
    expect(belt.floor).toBe(2);
    expect(belt.tier).toBe("pickup");
    expect(belt.chase).toBe(true);
    expect(belt.uniques.map((u) => u.name)).toEqual(["Headhunter", "Wurm's Molt"]);
    const plate = bases.find((b) => b.baseType === "Glorious Plate")!;
    expect([plate.floor, plate.tier, plate.chase]).toEqual([30, "valuable", false]);
  });

  it("thin listings never set a floor", () => {
    const ring = bases.find((b) => b.baseType === "Ruby Ring")!;
    expect(ring.floor).toBeNull();
    expect(ring.tier).toBe("ignore");
    expect(bases[0]!.baseType).toBe("Glorious Plate"); // highest floor first
  });
});

describe("loot filter", () => {
  it("writes show-only blocks per tier with quoted names", () => {
    const stackables = stackableTiers({ currency: snap([row("Divine Orb", 155), row("Hinekora's Lock", 7000), row("Orb of Alteration", 0.1)]) }, DEFAULT_THRESHOLDS);
    const bases = uniqueBases({ "unique-armours": snap([row("Kaom's Heart", 40, { baseType: "Glorious Plate" })]) }, DEFAULT_THRESHOLDS);
    const text = lootFilter({ league: "Covens", pricesAt: Date.UTC(2026, 10, 17, 14, 2), thresholds: DEFAULT_THRESHOLDS, stackables, bases, unit: "c" });
    expect(text).toContain("# Vaalytics · Loot Intelligence · Covens · poe.ninja prices from 2026-11-17 14:02 UTC");
    expect(text).toContain('Show # Vaalytics Top — stackables (2)\n    BaseType == "Hinekora\'s Lock" "Divine Orb"');
    expect(text).toContain('Show # Vaalytics Valuable — unique bases (1)\n    Rarity Unique\n    BaseType == "Glorious Plate"');
    expect(text).not.toContain("Orb of Alteration");
    expect(text).not.toMatch(/^Hide/m);
  });
});
