import { describe, expect, it } from "vitest";
import type { MarketItemRow, MarketSnapshot } from "@/core/ipc/commands";
import { parsePoe1Item } from "../parser";
import { ALL_MODIFIERS, findModifier, MODIFIER_FAMILIES, MODIFIER_SOURCE } from "./data/modifiers";
import { parseSacrifice, parseUltimatum, rewardKindOf } from "./parse";
import { assessRisk, isRatings, nextRating, setRating, ultimatumTradeQuery, valuate } from "./ultimatum";

/** Real Ctrl+C copy from the PoE 1 client (2026-11-25). */
const REAL = `Item Class: Misc Map Items
Rarity: Currency
Inscribed Ultimatum
--------
Challenge: Survive
Area Level: 83
Requires Sacrifice: Chaos Orb x10
Reward: Doubles sacrificed Currency
--------
Totem of Costly Potency
(An invulnerable Totem will appear that imbues both its allies and its enemies with Speed and powerful Elemental Damage benefits, but causes enemies to take 15% of their maximum Life and Energy Shield as Fire Damage per second)
Lessened Reach
(Players have 60% less Area of Effect and Projectile Speed)
Escalating Monster Speed
(Monsters gain 5% increased attack, cast, and movement speed per second they are alive, up to 50%)
Lightning Damage from Mana Costs
(Take 1000% of Mana costs as Lightning Damage)
Siphoned Charges
(Lose a Power, Frenzy, and Endurance Charge every second
Monsters gain Power, Frenzy, and Endurance Charges on hit)
Shattered Shield
(You cannot Block)
Prismatic Monsters
(Monsters gain 50% of Physical Damage as Extra Damage of each Element)
--------
Can be used in a personal map device to open portals to the Trialmaster's Domain and attempt his challenge. Portals will close once the challenge begins. While viewing your Atlas, Right-click this item to pinpoint its location.`;

const row = (name: string, value: number, variant: string | null = null): MarketItemRow => ({
  itemId: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  variant,
  icon: null,
  value,
  divineValue: null,
  change7d: null,
  sparkline: [],
  volumeValue: null,
  listings: 100,
});
const snap = (category: string, items: MarketItemRow[]) =>
  ({
    category,
    baseUnit: "chaos",
    source: "poe.ninja",
    items,
  }) as unknown as MarketSnapshot;

describe("modifier catalogue", () => {
  it("has every name once and the documented count", () => {
    expect(ALL_MODIFIERS).toHaveLength(MODIFIER_SOURCE.count);
    expect(new Set(MODIFIER_FAMILIES.map((f) => f.family)).size).toBe(MODIFIER_FAMILIES.length);
  });
  it("finds tiers by display name", () => {
    expect(findModifier("Ruin III")).toMatchObject({
      tier: 3,
      family: { family: "Ruin", kind: "penalty" },
    });
    expect(findModifier("quicksand i")?.tier).toBe(1);
    expect(findModifier("Harsh Lessons IV")?.family.kind).toBe("bonus");
    expect(findModifier("Not a modifier")).toBeNull();
  });
});

describe("parseUltimatum", () => {
  it("parses the real item copy", () => {
    const u = parseUltimatum(REAL)!;
    expect(u).toMatchObject({
      challenge: "Survive",
      challengeId: "Survival",
      areaLevel: 83,
      sacrifice: { name: "Chaos Orb", count: 10 },
      reward: "Doubles sacrificed Currency",
      rewardKind: "DoubleCurrency",
      rewardItem: null,
      corrupted: false,
    });
    expect(u.modifiers.map((m) => m.name)).toEqual([
      "Totem of Costly Potency",
      "Lessened Reach",
      "Escalating Monster Speed",
      "Lightning Damage from Mana Costs",
      "Siphoned Charges",
      "Shattered Shield",
      "Prismatic Monsters",
    ]);
    expect(u.modifiers.every((m) => m.family !== null && m.kind === "penalty")).toBe(true);
    expect(u.modifiers[4]!.description).toBe(
      "Lose a Power, Frenzy, and Endurance Charge every second Monsters gain Power, Frenzy, and Endurance Charges on hit",
    );
    expect(u.modifiers[5]!.description).toBe("You cannot Block");
  });

  it("handles CRLF and the shared item parser keeps the base type", () => {
    expect(parseUltimatum(REAL.replace(/\n/g, "\r\n"))?.modifiers).toHaveLength(7);
    const p = parsePoe1Item(REAL);
    expect(p.ok && p.item.baseType).toBe("Inscribed Ultimatum");
  });

  it("rejects other items", () => {
    expect(parseUltimatum("Item Class: Stackable Currency\nRarity: Currency\nChaos Orb\n--------\nStack Size: 1/20")).toBeNull();
  });

  it("keeps unknown modifier names (not in the catalogue) unrated", () => {
    const u = parseUltimatum(REAL.replace("Shattered Shield", "Brand New Modifier"))!;
    expect(u.modifiers[5]).toMatchObject({
      name: "Brand New Modifier",
      family: null,
      kind: null,
    });
  });

  it("reads sacrifices and reward kinds", () => {
    expect(parseSacrifice("Divine Orb x3")).toEqual({
      name: "Divine Orb",
      count: 3,
    });
    expect(parseSacrifice("Headhunter")).toEqual({
      name: "Headhunter",
      count: 1,
    });
    expect(rewardKindOf("Doubles sacrificed Divination Cards")).toBe("DoubleDivCards");
    expect(rewardKindOf("Mirrored Rare Item")).toBe("MirrorRare");
    expect(rewardKindOf("Mageblood")).toBe("ExchangeUnique");
  });
});

describe("ratings and risk", () => {
  const u = parseUltimatum(REAL)!;
  it("cycles ratings and validates stored values", () => {
    expect([nextRating(undefined), nextRating("ok"), nextRating("danger"), nextRating("forbidden")]).toEqual(["ok", "danger", "forbidden", undefined]);
    expect(setRating({ Ruin: "ok" }, "Ruin", undefined)).toEqual({});
    expect(isRatings({ Ruin: "danger" })).toBe(true);
    expect(isRatings({ Ruin: "bad" })).toBe(false);
    expect(isRatings([])).toBe(false);
  });
  it("skip beats careful beats unrated", () => {
    expect(assessRisk(u.modifiers, {}).verdict).toBe("unrated");
    const fine = Object.fromEntries(u.modifiers.map((m) => [m.family!, "ok" as const]));
    expect(assessRisk(u.modifiers, fine).verdict).toBe("ok");
    expect(assessRisk(u.modifiers, { ...fine, "Shattered Shield": "danger" })).toMatchObject({ verdict: "careful", danger: ["Shattered Shield"] });
    expect(
      assessRisk(u.modifiers, {
        ...fine,
        "Shattered Shield": "danger",
        "Lightning Damage from Mana Costs": "forbidden",
      }).verdict,
    ).toBe("skip");
  });
  it("ignores bonus modifiers", () => {
    expect(assessRisk([{ name: "Harsh Lessons II", family: "Harsh Lessons", kind: "bonus" }], {}).verdict).toBe("ok");
  });
});

describe("valuate", () => {
  const u = parseUltimatum(REAL)!;
  it("doubled currency: +stake on success, −stake on failure, 50% break-even", () => {
    const v = valuate({ ...u, sacrifice: { name: "Divine Orb", count: 2 } }, { currency: snap("currency", [row("Divine Orb", 200)]) });
    expect(v).toMatchObject({
      ok: true,
      stake: { low: 400, high: 400 },
      win: { low: 400, high: 400 },
      lose: { low: -400, high: -400 },
      byName: false,
    });
    expect(v.ok && v.breakEven).toBeCloseTo(0.5);
  });
  it("the purchase price raises the break-even rate", () => {
    const v = valuate({ ...u, sacrifice: { name: "Divine Orb", count: 1 } }, { currency: snap("currency", [row("Divine Orb", 200)]) }, 100);
    expect(v).toMatchObject({
      ok: true,
      win: { low: 100 },
      lose: { low: -300 },
    });
    expect(v.ok && v.breakEven).toBeCloseTo(0.75);
  });
  it("the base unit (Chaos Orb) is worth 1 without a poe.ninja row", () => {
    expect(valuate(u, { currency: snap("currency", [row("Divine Orb", 200)]) })).toMatchObject({ ok: true, stake: { low: 10, high: 10 } });
  });
  it("an unpriced currency gives an honest error", () => {
    expect(valuate({ ...u, sacrifice: { name: "Mystery Orb", count: 1 } }, { currency: snap("currency", []) })).toMatchObject({ ok: false });
  });
  it("unique exchange uses the range of name matches", () => {
    const ex = {
      ...u,
      rewardKind: "ExchangeUnique" as const,
      reward: "Mageblood",
      rewardItem: "Mageblood",
      sacrifice: { name: "Headhunter", count: 1 },
    };
    const v = valuate(ex, {
      "unique-accessories": snap("unique-accessories", [row("Mageblood", 30000), row("Headhunter", 9000), row("Headhunter", 11000, "Relic")]),
    });
    expect(v).toMatchObject({
      ok: true,
      stake: { low: 9000, high: 11000 },
      win: { low: 19000, high: 21000 },
      byName: true,
    });
  });
  it("mirrored rares are never priced", () => {
    expect(valuate({ ...u, rewardKind: "MirrorRare" }, {})).toMatchObject({
      ok: false,
    });
  });
});

describe("ultimatumTradeQuery", () => {
  it("uses the official filter ids", () => {
    const q = ultimatumTradeQuery(parseUltimatum(REAL)!) as {
      query: {
        type: string;
        filters: { ultimatum_filters: { filters: Record<string, unknown> } };
      };
    };
    expect(q.query.type).toBe("Inscribed Ultimatum");
    expect(q.query.filters.ultimatum_filters.filters).toEqual({
      ultimatum_challenge: { option: "Survival" },
      ultimatum_reward: { option: "DoubleCurrency" },
      ultimatum_input: { option: "Chaos Orb" },
    });
  });
});
