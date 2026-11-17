import { describe, expect, it } from "vitest";
import { parsePoe1ItemForTest, parsePoe2ItemForTest, parseRareForTest, parseTamingForTest } from "./test-fixtures";
import { estimatePrice } from "./estimate";
import { buildFilters, buildQuery, defaultOptions, suggestedMin } from "./query";
import { buildStatIndex, matchMod, templateKey, type TradeStat } from "./stats";

// Real entries from /api/trade/data/stats (PoE 1) and /api/trade2/data/stats (PoE 2), Nov 2026.
const POE1_STATS: TradeStat[] = [
  { id: "pseudo.pseudo_total_fire_resistance", text: "+#% total to Fire Resistance", type: "pseudo" },
  { id: "pseudo.pseudo_total_cold_resistance", text: "+#% total to Cold Resistance", type: "pseudo" },
  { id: "pseudo.pseudo_total_lightning_resistance", text: "+#% total to Lightning Resistance", type: "pseudo" },
  { id: "pseudo.pseudo_total_elemental_resistance", text: "+#% total Elemental Resistance", type: "pseudo" },
  { id: "pseudo.pseudo_total_life", text: "+# total maximum Life", type: "pseudo" },
  { id: "explicit.stat_3299347043", text: "+# to maximum Life", type: "explicit" },
  { id: "explicit.stat_3032590688", text: "Adds # to # Physical Damage to Attacks", type: "explicit" },
  { id: "explicit.stat_803737631", text: "+# to Accuracy Rating", type: "explicit" },
  { id: "explicit.stat_1050105434", text: "+# to maximum Mana", type: "explicit" },
  { id: "implicit.stat_2915988346", text: "+#% to Fire and Cold Resistances", type: "implicit" },
  { id: "explicit.stat_2915988346", text: "+#% to Fire and Cold Resistances", type: "explicit" },
  { id: "explicit.stat_2250533757", text: "#% increased Movement Speed", type: "explicit" },
  // Real entries involved in the "The Taming" report (Nov 2026).
  { id: "pseudo.pseudo_total_all_elemental_resistances", text: "+#% total to all Elemental Resistances", type: "pseudo" },
  { id: "pseudo.pseudo_total_resistance", text: "+#% total Resistance", type: "pseudo" },
  { id: "explicit.stat_2901986750", text: "+#% to all Elemental Resistances", type: "explicit" },
  { id: "implicit.stat_2901986750", text: "+#% to all Elemental Resistances", type: "implicit" },
  { id: "explicit.stat_800141891", text: "#% chance to Freeze, Shock and Ignite", type: "explicit" },
  { id: "explicit.stat_2605663324", text: "#% increased Elemental Damage with Hits and Ailments for\neach type of Elemental Ailment on Enemy", type: "explicit" },
  { id: "explicit.stat_3372524247", text: "+#% to Fire Resistance", type: "explicit" },
];
const POE2_STATS: TradeStat[] = [
  { id: "explicit.stat_3299347043", text: "# to maximum Life", type: "explicit" },
  { id: "explicit.stat_1671376347", text: "#% to Lightning Resistance", type: "explicit" },
  { id: "implicit.stat_4220027924", text: "#% to Cold Resistance", type: "implicit" },
  { id: "pseudo.pseudo_total_cold_resistance", text: "+#% total to Cold Resistance", type: "pseudo" },
  { id: "pseudo.pseudo_total_lightning_resistance", text: "+#% total to Lightning Resistance", type: "pseudo" },
  { id: "pseudo.pseudo_total_elemental_resistance", text: "+#% total Elemental Resistance", type: "pseudo" },
];

describe("stat matching", () => {
  it("normalizes signs so PoE 1 and PoE 2 templates compare equal", () => {
    expect(templateKey("+68 to maximum Life")).toBe("# to maximum Life");
    expect(templateKey("+# to maximum Life")).toBe(templateKey("# to maximum Life"));
    expect(templateKey("Adds 3 to 7 Physical Damage")).toBe("Adds # to # Physical Damage");
  });

  it("matches by kind, averages ranges, inverts reduced/increased", () => {
    const idx = buildStatIndex(POE1_STATS);
    const mod = (text: string, kind: "explicit" | "implicit" = "explicit", values: number[] = (text.match(/\d+/g) ?? []).map(Number)) =>
      ({ id: "x", kind, text, values, raw: text });
    expect(matchMod(mod("+78 to maximum Life"), idx)).toMatchObject({ stat: { id: "explicit.stat_3299347043" }, value: 78 });
    expect(matchMod(mod("Adds 3 to 7 Physical Damage to Attacks"), idx)?.value).toBe(5);
    expect(matchMod(mod("+15% to Fire and Cold Resistances", "implicit"), idx)?.stat.id).toBe("implicit.stat_2915988346");
    expect(matchMod(mod("10% reduced Movement Speed"), idx)).toMatchObject({ stat: { id: "explicit.stat_2250533757" }, value: -10 });
    expect(matchMod(mod("Totally unknown stat 5"), idx)).toBeNull();
  });
});

describe("filters and query", () => {
  it("builds PoE 1 filters with pseudo totals covering their mods", () => {
    const item = parsePoe1ItemForTest();
    const { stats, unmatched } = buildFilters(item, buildStatIndex(POE1_STATS));
    const byLabel = Object.fromEntries(stats.map((s) => [s.label, s]));
    expect(byLabel["+30% total Elemental Resistance"]).toMatchObject({ enabled: true, source: "pseudo", min: 27 });
    expect(byLabel["+78 total maximum Life"]).toMatchObject({ enabled: true, min: 70 });
    // Covered by pseudo life → not enabled twice.
    expect(byLabel["+78 to maximum Life"]).toMatchObject({ enabled: false });
    expect(byLabel["+106 to Accuracy Rating"]).toMatchObject({ enabled: true, min: 95 });
    expect(unmatched).toEqual([]);

    const q = buildQuery(item, stats, defaultOptions(item)) as { query: Record<string, unknown>; sort: unknown };
    expect(q.sort).toEqual({ price: "asc" });
    expect(q.query).toMatchObject({ status: { option: "online" }, type: "Two-Stone Ring", filters: { type_filters: { filters: { rarity: { option: "rare" } } } } });
    const filters = (q.query.stats as { filters: { id: string }[] }[])[0]!.filters.map((f) => f.id);
    expect(filters).toContain("pseudo.pseudo_total_elemental_resistance");
    expect(filters).not.toContain("explicit.stat_3299347043");
  });

  it("only offers pseudo stats the game supports (PoE 2)", () => {
    const item = parsePoe2ItemForTest();
    const { stats } = buildFilters(item, buildStatIndex(POE2_STATS));
    expect(stats.some((s) => s.statId === "pseudo.pseudo_total_life")).toBe(false);
    expect(stats.find((s) => s.statId === "pseudo.pseudo_total_elemental_resistance")?.value).toBe(53);
    expect(stats.find((s) => s.label === "+89 to maximum Life")).toMatchObject({ statId: "explicit.stat_3299347043", enabled: true });
  });

  it("does not enable totals made only of crafted mods", () => {
    const item = parsePoe1ItemForTest();
    item.mods.push({ id: "c1", kind: "crafted", text: "+21% to Chaos Resistance", values: [21], raw: "" });
    const stats = [...POE1_STATS, { id: "pseudo.pseudo_total_chaos_resistance", text: "+#% total to Chaos Resistance", type: "pseudo" }];
    const f = buildFilters(item, buildStatIndex(stats)).stats.find((s) => s.statId === "pseudo.pseudo_total_chaos_resistance");
    expect(f).toMatchObject({ value: 21, enabled: false });
  });

  it("suggests rounded minimums", () => {
    expect(suggestedMin(78)).toBe(70);
    expect(suggestedMin(4.5)).toBe(4);
    expect(suggestedMin(null)).toBeNull();
  });
});

describe("estimate", () => {
  it("returns null without convertible prices", () => {
    expect(estimatePrice([{ amountBase: null }])).toBeNull();
  });
  it("ignores bait listings and grades confidence", () => {
    const e = estimatePrice([1, 40, 41, 42, 42, 43, 44, 45, 46, 60].map((amountBase) => ({ amountBase })))!;
    expect(e.outliers).toBe(1);
    expect(e.low).toBe(40);
    expect(e.estimate).toBe(42);
    expect(e.confidence).toBe("high");
    expect(estimatePrice([{ amountBase: 10 }, { amountBase: 90 }])!.confidence).toBe("low");
  });
});

describe("user report: The Taming", () => {
  const idx = buildStatIndex(POE1_STATS);

  it("keeps reminder text and flavour out of modifiers", () => {
    const item = parseTamingForTest();
    expect(item.mods.map((m) => m.text)).toEqual([
      "+10% to all Elemental Resistances",
      "+24% to all Elemental Resistances",
      "10% chance to Freeze, Shock and Ignite",
      "31% increased Elemental Damage with Hits and Ailments for",
      "each type of Elemental Ailment on Enemy",
    ]);
    expect(item.description.filter((d) => d.startsWith("("))).toHaveLength(3);
    expect(item.unparsed).toEqual([]);
  });

  it("matches the two-line modifier as one stat and adds no pseudo totals to a unique", () => {
    const { stats, unmatched } = buildFilters(parseTamingForTest(), idx);
    expect(unmatched).toEqual([]);
    expect(stats.some((s) => s.source === "pseudo")).toBe(false);
    expect(stats.map((s) => [s.statId, s.value])).toEqual([
      ["implicit.stat_2901986750", 10],
      ["explicit.stat_2901986750", 24],
      ["explicit.stat_800141891", 10],
      ["explicit.stat_2605663324", 31],
    ]);
    expect(stats.every((s) => !s.enabled)).toBe(true);
  });
});

describe("all-elemental resistances stay one number", () => {
  const idx = buildStatIndex(POE1_STATS);

  it("rare with only all-res: one pseudo, not split per element", () => {
    const { stats } = buildFilters(parseRareForTest("+24% to all Elemental Resistances"), idx);
    const pseudo = stats.filter((s) => s.source === "pseudo");
    expect(pseudo.map((s) => [s.statId, s.value, s.enabled])).toEqual([["pseudo.pseudo_total_all_elemental_resistances", 24, true]]);
  });

  it("mixed sources: totals include all-res, no rows for absent elements", () => {
    const { stats } = buildFilters(parseRareForTest("+10% to all Elemental Resistances\n+30% to Fire Resistance"), idx);
    const pseudo = Object.fromEntries(stats.filter((s) => s.source === "pseudo").map((s) => [s.statId, s.value]));
    expect(pseudo).toEqual({
      "pseudo.pseudo_total_all_elemental_resistances": 10,
      "pseudo.pseudo_total_elemental_resistance": 60,
      "pseudo.pseudo_total_fire_resistance": 40,
    });
    expect(stats.find((s) => s.statId === "pseudo.pseudo_total_elemental_resistance")?.enabled).toBe(true);
    expect(stats.find((s) => s.statId === "pseudo.pseudo_total_all_elemental_resistances")?.enabled).toBe(false);
  });
});
