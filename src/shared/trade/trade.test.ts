import { describe, expect, it } from "vitest";
import { parseClusterForTest, parseCorpseForTest, parseDivCardForTest, parseTattooForTest, parseNebulisForTest, parseRealBootsForTest, parsePoe1ItemForTest, parsePoe2ItemForTest, parseRareForTest, parseTamingForTest, parseTransfiguredGemForTest } from "./test-fixtures";
import { applyMode, applyRange, buildFilters, buildQuery, defaultOptions, marketLookupCategories, rangeFor, searchBasis, splitOptionId, suggestedMin, tradeSiteSearchUrl } from "./query";
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
    expect(q.query).toMatchObject({ status: { option: "available" }, type: "Two-Stone Ring", filters: { type_filters: { filters: { rarity: { option: "rare" } } } } });
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

  it("suggests whole-number minimums (user report: no 1.2)", () => {
    expect(suggestedMin(78)).toBe(70);
    expect(suggestedMin(4.5)).toBe(4);
    expect(suggestedMin(1.4)).toBe(1);
    expect(suggestedMin(2)).toBe(2);
    expect(suggestedMin(15)).toBe(13);
    expect(suggestedMin(36.5)).toBe(32);
    expect(suggestedMin(-10)).toBe(-10);
    // Rolls below 1 (0.4 % leech) can't be rounded to a useful whole number.
    expect(suggestedMin(0.4)).toBe(0.4);
    expect(suggestedMin(null)).toBeNull();
    for (const v of [1.2, 3.3, 9.9, 10.5, 47.25, 120.5]) expect(Number.isInteger(suggestedMin(v))).toBe(true);
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

describe("user report: transfigured gems", () => {
  const variants = [{ text: "Static Strike of Gathering Lightning", type: "Static Strike", disc: "alt_x" }];
  it("searches base gem + discriminator", () => {
    const gem = parseTransfiguredGemForTest();
    expect(gem.rarity).toBe("Gem");
    expect(gem.baseType).toBe("Static Strike of Gathering Lightning");
    const q = buildQuery(gem, [], defaultOptions(gem), variants).query as Record<string, unknown>;
    expect(q.type).toEqual({ option: "Static Strike", discriminator: "alt_x" });
    expect((q.filters as { misc_filters: { filters: Record<string, unknown> } }).misc_filters.filters.gem_level).toEqual({ min: 15 });
  });

  it("defaults: comparable level and quality, exact corruption, instant buyout + online", () => {
    const gem = parseTransfiguredGemForTest();
    const o = defaultOptions(gem);
    expect(o).toMatchObject({ status: "available", corrupted: "no", gemLevel: { min: 15, max: null }, gemQuality: { min: 5, max: null } });
    expect(gem.requirements).toEqual({ level: 59, str: 83, dex: undefined, int: 58 });
    expect(gem.unparsed).toEqual([]);
    expect(gem.properties.find((p) => p.name === "Tags")?.value).toBe("Attack, Melee, Strike, Duration, Lightning, Chaining");
  });

  it("user-chosen level, quality and corruption go into misc filters", () => {
    const gem = parseTransfiguredGemForTest();
    const opts = { ...defaultOptions(gem), corrupted: "yes" as const, gemLevel: { min: 20, max: 20 }, gemQuality: { min: null, max: null }, status: "any" as const };
    const q = buildQuery(gem, [], opts, variants).query as { status: unknown; filters: { misc_filters: { filters: Record<string, unknown> } } };
    expect(q.status).toEqual({ option: "any" });
    expect(q.filters.misc_filters.filters).toEqual({ corrupted: { option: "true" }, gem_level: { min: 20, max: 20 } });
  });

  it("PoE 2 defaults to online sellers (no instant buyout there)", () => {
    expect(defaultOptions(parsePoe2ItemForTest()).status).toBe("online");
  });

  it("plain gems keep their name", () => {
    const gem = { ...parseTransfiguredGemForTest(), baseType: "Static Strike" };
    expect((buildQuery(gem, [], defaultOptions(gem), variants).query as Record<string, unknown>).type).toBe("Static Strike");
  });
});

describe("user report: cluster jewels (0 results)", () => {
  // Real entries from /api/trade/data/stats (PoE 1, Nov 2026). Option values are listed as `id|option`.
  const CLUSTER_STATS: TradeStat[] = [
    { id: "enchant.stat_3086156145", text: "Adds # Passive Skills", type: "enchant" },
    { id: "enchant.stat_3948993189|42", text: "Added Small Passive Skills grant: 15% increased Armour", type: "enchant" },
    { id: "enchant.stat_3948993189|43", text: "Added Small Passive Skills grant: 15% increased Evasion Rating", type: "enchant" },
    { id: "explicit.stat_3819827377", text: "Added Small Passive Skills also grant: +# to Maximum Life", type: "explicit" },
  ];
  const index = buildStatIndex(CLUSTER_STATS);

  it("splits option ids", () => {
    expect(splitOptionId("enchant.stat_3948993189|42")).toEqual({ id: "enchant.stat_3948993189", option: 42 });
    expect(splitOptionId("explicit.stat_1")).toEqual({ id: "explicit.stat_1" });
  });

  it("parses the enchants as enchant mods", () => {
    const item = parseClusterForTest();
    expect(item.mods.filter((m) => m.kind === "enchant").map((m) => m.text)).toEqual([
      "Adds 2 Passive Skills",
      "Added Small Passive Skills grant: 15% increased Armour",
    ]);
  });

  it("searches the passive type as { option } and the passive count exactly, both enabled", () => {
    const item = parseClusterForTest();
    const { stats } = buildFilters(item, index);
    const count = stats.find((s) => s.statId === "enchant.stat_3086156145")!;
    const type = stats.find((s) => s.statId === "enchant.stat_3948993189")!;
    expect(count).toMatchObject({ enabled: true, min: 2, max: 2 });
    expect(type).toMatchObject({ enabled: true, option: 42, value: null, min: null, max: null });

    const q = buildQuery(item, stats, defaultOptions(item)).query as { type: string; stats: { filters: { id: string; value: unknown }[] }[] };
    expect(q.type).toBe("Small Cluster Jewel");
    const filters = q.stats[0]!.filters;
    // A min on an option stat makes Trade return 0 results (verified live, Nov 2026).
    expect(filters.find((f) => f.id === "enchant.stat_3948993189")!.value).toEqual({ option: 42 });
    expect(filters.find((f) => f.id === "enchant.stat_3086156145")!.value).toEqual({ min: 2, max: 2 });
  });

  it("magic cluster jewels are searched by their base", () => {
    const item = parseClusterForTest("Magic");
    expect(item.baseType).toBe("Lustrous Small Cluster Jewel of the Sample");
    const q = buildQuery(item, buildFilters(item, index).stats, defaultOptions(item)).query as Record<string, unknown>;
    expect(q.type).toBe("Small Cluster Jewel");
  });
});

describe("user report: corpses (no search, 4 'unmatched' mods)", () => {
  // The real stat list contains "#% chance to inflict Withered for 2 seconds on Hit": it must not match a corpse ability.
  const index = buildStatIndex([{ id: "explicit.stat_1957711555", text: "#% chance to inflict Withered for 2 seconds on Hit", type: "explicit" }]);

  it("searches by base type only, without warnings about the monster's abilities", () => {
    const item = parseCorpseForTest();
    expect(item).toMatchObject({ itemClass: "Corpses", rarity: "Currency", baseType: "Perfect Serpent Warrior", itemLevel: 83 });
    expect(item.mods).toHaveLength(4);
    const f = buildFilters(item, index);
    expect(f).toEqual({ stats: [], unmatched: [] });
    const q = buildQuery(item, f.stats, defaultOptions(item)).query as Record<string, unknown>;
    expect(q).toEqual({ status: { option: "available" }, type: "Perfect Serpent Warrior" });
  });
});

describe("user report: HTTP 405 (Trade refusing automated searches)", () => {
  it("builds a Trade site link carrying the same query", () => {
    const q = { query: { status: { option: "available" }, type: "Foulborn Exalted Orb" }, sort: { price: "asc" } };
    const url = tradeSiteSearchUrl("poe1", "Covens", q);
    expect(url.startsWith("https://www.pathofexile.com/trade/search/Covens?q=")).toBe(true);
    expect(JSON.parse(decodeURIComponent(url.split("?q=")[1]!))).toEqual(q);
    expect(tradeSiteSearchUrl("poe2", "Runes of Aldur", q)).toMatch(/^https:\/\/www\.pathofexile\.com\/trade2\/search\/poe2\/Runes%20of%20Aldur\?q=/);
  });
});

describe("rework: roll ranges, search basis, modes, pseudo sums", () => {
  it("suggests whole-number ranges around the roll (+83 life)", () => {
    expect(rangeFor(83, "min10")).toEqual({ min: 74, max: null });
    expect(rangeFor(83, "pm10")).toEqual({ min: 74, max: 92 });
    expect(rangeFor(83, "pm20")).toEqual({ min: 66, max: 100 });
    expect(rangeFor(83, "exact")).toEqual({ min: 83, max: 83 });
    expect(rangeFor(-30, "pm10")).toEqual({ min: -33, max: -27 });
    expect(rangeFor(null, "pm10")).toEqual({ min: null, max: null });
  });

  it("a rare with no enabled modifier is a base-type-only search; a currency is exact", () => {
    const rare = parseRareForTest("+80 to maximum Life\n+40% to Fire Resistance");
    const { stats } = buildFilters(rare, buildStatIndex(POE1_STATS));
    expect(searchBasis(rare, stats)).toBe("stats");
    expect(searchBasis(rare, applyMode(stats, stats, "base"))).toBe("base");
    expect(searchBasis(parseCorpseForTest(), [])).toBe("exact");
  });

  it("leaving base-type mode restores the default selection", () => {
    const rare = parseRareForTest("+80 to maximum Life\n+40% to Fire Resistance");
    const { stats } = buildFilters(rare, buildStatIndex(POE1_STATS));
    const back = applyMode(applyMode(stats, stats, "base"), stats, "quick");
    expect(back.map((s) => s.enabled)).toEqual(stats.map((s) => s.enabled));
  });

  it("applies a range to numeric filters but keeps exact cluster enchants and options", () => {
    const item = parseClusterForTest();
    const index = buildStatIndex([
      { id: "enchant.stat_3086156145", text: "Adds # Passive Skills", type: "enchant" },
      { id: "enchant.stat_3948993189|42", text: "Added Small Passive Skills grant: 15% increased Armour", type: "enchant" },
      { id: "explicit.stat_3819827377", text: "Added Small Passive Skills also grant: +# to Maximum Life", type: "explicit" },
    ]);
    const out = applyRange(buildFilters(item, index).stats, "pm20");
    expect(out.find((s) => s.statId === "enchant.stat_3086156145")).toMatchObject({ min: 2, max: 2 });
    expect(out.find((s) => s.statId === "enchant.stat_3948993189")).toMatchObject({ option: 42, min: null });
    expect(out.find((s) => s.statId === "explicit.stat_3819827377")).toMatchObject({ min: 8, max: 12 });
  });

  it("sums attributes from several lines into one pseudo total and shows its sources", () => {
    const item = parseRareForTest("+20 to Strength\n+15 to Strength and Dexterity\n+10 to all Attributes\n+30 to maximum Mana");
    const index = buildStatIndex([
      { id: "pseudo.pseudo_total_strength", text: "+# total to Strength", type: "pseudo" },
      { id: "pseudo.pseudo_total_dexterity", text: "+# total to Dexterity", type: "pseudo" },
      { id: "pseudo.pseudo_total_mana", text: "+# total maximum Mana", type: "pseudo" },
      { id: "explicit.stat_4080418644", text: "+# to Strength", type: "explicit" },
      { id: "explicit.stat_538848803", text: "+# to Strength and Dexterity", type: "explicit" },
      { id: "explicit.stat_1379411836", text: "+# to all Attributes", type: "explicit" },
      { id: "explicit.stat_1050105434", text: "+# to maximum Mana", type: "explicit" },
    ]);
    const { stats } = buildFilters(item, index);
    const str = stats.find((s) => s.statId === "pseudo.pseudo_total_strength")!;
    expect(str).toMatchObject({ value: 45, enabled: true, sources: ["+20 to Strength", "+15 to Strength and Dexterity", "+10 to all Attributes"] });
    expect(stats.find((s) => s.statId === "pseudo.pseudo_total_dexterity")).toMatchObject({ value: 25 });
    // One mana line is its own filter — no pseudo for a single source.
    expect(stats.find((s) => s.statId === "pseudo.pseudo_total_mana")).toBeUndefined();
    // Lines inside an enabled total start disabled (no double counting).
    expect(stats.find((s) => s.label === "+20 to Strength")?.enabled).toBe(false);
  });
});

describe("live finding: local stats on armour (a rare boot's own search found 0 listings)", () => {
  // Real ids from /api/trade/data/stats (PoE 1, 2026-11-25).
  const index = buildStatIndex([
    { id: "explicit.stat_2106365538", text: "#% increased Evasion Rating", type: "explicit" },
    { id: "explicit.stat_124859000", text: "#% increased Evasion Rating (Local)", type: "explicit" },
    { id: "explicit.stat_809229260", text: "+# to Armour", type: "explicit" },
    { id: "explicit.stat_3484657501", text: "+# to Armour (Local)", type: "explicit" },
    { id: "explicit.stat_3261801346", text: "+# to Dexterity", type: "explicit" },
  ]);

  it("searches the local variant on items with their own defences", () => {
    const boots = parseRealBootsForTest();
    const { stats } = buildFilters(boots, index);
    expect(stats.find((s) => s.label === "39% increased Evasion Rating")?.statId).toBe("explicit.stat_124859000");
    // Non-local lines are unaffected.
    expect(stats.find((s) => s.label === "+40 to Dexterity")?.statId).toBe("explicit.stat_3261801346");
  });

  it("jewellery keeps the global stat", () => {
    const ring = parseRareForTest("+120 to Armour");
    expect(buildFilters(ring, index).stats.find((s) => s.label === "+120 to Armour")?.statId).toBe("explicit.stat_809229260");
  });
});

describe("user report: synthesised unique (Unknown item base type)", () => {
  // Real id from /api/trade/data/stats (PoE 1, 2026-11-25).
  const index = buildStatIndex([{ id: "explicit.stat_2304729532", text: "#% increased Implicit Modifier magnitudes", type: "explicit" }]);

  it("searches the base without the Synthesised prefix, with the Synthesised Item filter", () => {
    const item = parseNebulisForTest();
    expect(item).toMatchObject({ rarity: "Unique", name: "Nebulis", baseType: "Void Sceptre", synthesised: true });
    const q = buildQuery(item, [], defaultOptions(item)).query as { name: string; type: string; filters: { misc_filters: { filters: Record<string, unknown> } } };
    expect(q.name).toBe("Nebulis");
    expect(q.type).toBe("Void Sceptre");
    expect(q.filters.misc_filters.filters.synthesised_item).toEqual({ option: "true" });
  });

  it("advanced copy: the Unscalable Value marker is not part of the modifier", () => {
    const item = parseNebulisForTest(true);
    const mod = item.mods.find((m) => m.text.startsWith("109%"))!;
    expect(mod.text).toBe("109% increased Implicit Modifier magnitudes");
    const { stats, unmatched } = buildFilters(item, index);
    expect(unmatched.map((u) => u.text)).not.toContain("109% increased Implicit Modifier magnitudes");
    expect(stats.find((s) => s.statId === "explicit.stat_2304729532")).toMatchObject({ value: 109 });
  });
});

describe("user reports: bulk goods are priced from poe.ninja (Currency Exchange)", () => {
  const POE1_EXCHANGE = ["currency", "fragments", "essences", "fossils", "resonators", "oils", "delirium-orbs", "divination", "tattoos", "omens", "artifacts"];
  it("PoE 1 cards look only in the divination category", () => {
    const card = parseDivCardForTest();
    expect(card).toMatchObject({ itemClass: "Divination Cards", rarity: "Divination Card", stackSize: { current: 1, max: 11 } });
    expect(card.baseType ?? card.name).toBe("The Dragon's Heart");
    expect(marketLookupCategories(card, POE1_EXCHANGE)).toEqual(["divination"]);
  });
  it("stackable currency (tattoo: Trade said ~15 c, exchange 87:1) looks in every exchange category but cards", () => {
    const tattoo = parseTattooForTest();
    expect(tattoo).toMatchObject({ itemClass: "Stackable Currency", rarity: "Currency", baseType: "Tattoo of the Arohongui Warrior" });
    const cats = marketLookupCategories(tattoo, POE1_EXCHANGE);
    expect(cats).toContain("tattoos");
    expect(cats).toContain("currency");
    expect(cats).not.toContain("divination");
  });
  it("rares, uniques and corpses stay on Trade; a game without cards gets no card lookup", () => {
    expect(marketLookupCategories(parsePoe1ItemForTest(), POE1_EXCHANGE)).toEqual([]);
    expect(marketLookupCategories(parseCorpseForTest(), POE1_EXCHANGE)).toEqual([]);
    expect(marketLookupCategories({ ...parseDivCardForTest(), game: "poe2" }, ["currency", "runes"])).toEqual([]);
  });
});
