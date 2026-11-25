import { describe, expect, it } from "vitest";
import { extractRanges, isItemText, stripMarkup } from "@/shared/item-parser/core";
import { parsePoe1Item } from ".";
import { CLUSTER_TEXT, CORPSE_TEXT, NEBULIS_ADVANCED_TEXT } from "@/shared/trade/test-fixtures";

// Real item text returned by the PoE 1 trade API (item.extended.text), Nov 2026.
const TRADE_SIMPLE = `Item Class: Rings
Rarity: Rare
Pain Turn
Two-Stone Ring
--------
Requirements:
Level: 24
--------
Item Level: 40
--------
+15% to Fire and Cold Resistances
--------
Adds 3 to 7 Physical Damage to Attacks
+106 to Accuracy Rating
+78 to maximum Life
+27 to maximum Mana
--------
Note: ~price 1 alch
`;

// Constructed from the documented advanced-copy format (headers, ranges, markers).
// Replace with an in-game capture when available.
const ADVANCED_RARE = `Item Class: Body Armours
Rarity: Rare
Sample Shell
Astral Plate
--------
Quality: +20% (augmented)
Armour: 1024 (augmented)
--------
Requirements:
Level: 62
Str: 180
--------
Sockets: R-R-R-G-G B
--------
Item Level: 86
--------
{ Implicit Modifier — Elemental, Resistance }
+10(8-12)% to all Elemental Resistances (implicit)
--------
{ Fractured Prefix Modifier "Prime" (Tier: 1) — Life }
+120(110-119) to maximum Life (fractured)
{ Suffix Modifier "of the Rainbow" (Tier: 2) — Elemental, Resistance }
+14(13-15)% to all Elemental Resistances
{ Master Crafted Suffix Modifier "Upgraded" — Chaos, Resistance }
+21(21-25)% to Chaos Resistance (crafted)
{ Prefix Modifier "Thickened" (Tier: 3) — Defences }
42(39-42)% increased Armour
--------
Fractured Item
--------
Shaper Item
--------
Corrupted
`;

const UNIQUE = `Item Class: Body Armours
Rarity: Unique
Sample Covenant
Spidersilk Robe
--------
Energy Shield: 220
--------
Item Level: 84
--------
{ Unique Modifier — Gem }
Socketed Gems are Supported by Level 22 Blood Magic
{ Unique Modifier — Defences, Energy Shield }
+150(100-150) to maximum Energy Shield
--------
A sample of flavour text
that spans two lines.
`;

const CURRENCY = `Item Class: Stackable Currency
Rarity: Currency
Divine Orb
--------
Stack Size: 7/20
--------
Randomises the numeric values of the random modifiers on an item
--------
Right click this item then left click a magic, rare or unique item to apply it.
`;

describe("PoE 1 parser", () => {
  it("rejects non-item text", () => {
    expect(isItemText("hello")).toBe(false);
    const r = parsePoe1Item("hello world");
    expect(r.ok).toBe(false);
  });

  it("parses the real trade-format rare", () => {
    const r = parsePoe1Item(TRADE_SIMPLE);
    if (!r.ok) throw new Error(r.error);
    const it = r.item;
    expect(it).toMatchObject({ itemClass: "Rings", rarity: "Rare", name: "Pain Turn", baseType: "Two-Stone Ring", itemLevel: 40, note: "~price 1 alch" });
    expect(it.requirements?.level).toBe(24);
    expect(it.mods.map((m) => m.text)).toEqual([
      "+15% to Fire and Cold Resistances",
      "Adds 3 to 7 Physical Damage to Attacks",
      "+106 to Accuracy Rating",
      "+78 to maximum Life",
      "+27 to maximum Mana",
    ]);
    expect(it.mods[1]!.values).toEqual([3, 7]);
    expect(it.unparsed).toEqual([]);
  });

  it("parses advanced copy: headers, tiers, ranges, markers and flags", () => {
    const r = parsePoe1Item(ADVANCED_RARE);
    if (!r.ok) throw new Error(r.error);
    const it = r.item;
    expect(it.quality).toBe(20);
    expect(it.properties.find((p) => p.name === "Armour")).toMatchObject({ value: "1024", augmented: true });
    expect(it.requirements).toMatchObject({ level: 62, str: 180 });
    expect(it.sockets).toBe("R-R-R-G-G B");
    expect(it.links).toBe(5);
    expect(it.itemLevel).toBe(86);

    const [imp, life, res, chaos, armour] = it.mods;
    expect(imp).toMatchObject({ kind: "implicit", text: "+10% to all Elemental Resistances", values: [10], ranges: [[8, 12]] });
    expect(life).toMatchObject({ kind: "fractured", generation: "prefix", tier: 1, modName: "Prime", text: "+120 to maximum Life" });
    expect(res).toMatchObject({ kind: "explicit", generation: "suffix", tier: 2, tags: ["Elemental", "Resistance"] });
    expect(chaos).toMatchObject({ kind: "crafted", generation: "suffix", text: "+21% to Chaos Resistance" });
    expect(armour).toMatchObject({ kind: "explicit", tier: 3, text: "42% increased Armour", values: [42] });

    expect(it).toMatchObject({ fractured: true, corrupted: true, influences: ["Shaper"] });
    expect(it.unparsed).toEqual([]);
  });

  it("keeps unique flavour text as description, not mods or warnings", () => {
    const r = parsePoe1Item(UNIQUE);
    if (!r.ok) throw new Error(r.error);
    expect(r.item.name).toBe("Sample Covenant");
    expect(r.item.mods).toHaveLength(2);
    expect(r.item.description).toEqual(["A sample of flavour text", "that spans two lines."]);
    expect(r.item.unparsed).toEqual([]);
  });

  it("parses currency stacks without inventing a name", () => {
    const r = parsePoe1Item(CURRENCY);
    if (!r.ok) throw new Error(r.error);
    expect(r.item).toMatchObject({ rarity: "Currency", baseType: "Divine Orb", stackSize: { current: 7, max: 20 } });
    expect(r.item.name).toBeUndefined();
    expect(r.item.mods).toEqual([]);
    expect(r.item.description).toHaveLength(2);
  });

  it("parses a cluster jewel: enchants, explicit, help text", () => {
    const r = parsePoe1Item(CLUSTER_TEXT("Rare"));
    if (!r.ok) throw new Error(r.error);
    expect(r.item).toMatchObject({ rarity: "Rare", name: "Sample Spark", baseType: "Small Cluster Jewel", itemLevel: 84 });
    expect(r.item.mods.map((m) => [m.kind, m.text])).toEqual([
      ["enchant", "Adds 2 Passive Skills"],
      ["enchant", "Added Small Passive Skills grant: 15% increased Armour"],
      ["explicit", "Added Small Passive Skills also grant: +10 to Maximum Life"],
    ]);
    expect(r.item.unparsed).toEqual([]);
  });

  it("cluster explicits with a colon are modifiers, not properties (copy without headers)", () => {
    const text = CLUSTER_TEXT("Rare").replace(/\{ Prefix Modifier[^\n]*\n/, "");
    const r = parsePoe1Item(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.item.mods.map((m) => m.text)).toContain("Added Small Passive Skills also grant: +10 to Maximum Life");
    expect(r.item.properties.map((p) => p.name)).not.toContain("Added Small Passive Skills also grant");
    expect(r.item.unparsed).toEqual([]);
  });

  it("parses a Necropolis corpse (real Trade text)", () => {
    const r = parsePoe1Item(CORPSE_TEXT);
    if (!r.ok) throw new Error(r.error);
    expect(r.item).toMatchObject({ itemClass: "Corpses", rarity: "Currency", baseType: "Perfect Serpent Warrior", itemLevel: 83 });
    expect(r.item.properties.map((p) => [p.name, p.value])).toEqual([["Corpse Level", "83"], ["Monster Category", "Eldritch"]]);
    expect(r.item.mods.map((m) => m.text)).toContain("Fires Mortars when Defensive");
    expect(r.item.unparsed).toEqual([]);
  });

  it("synthesised unique: base without prefix, flag set, Unscalable Value marker stripped (real Trade text)", () => {
    const r = parsePoe1Item(NEBULIS_ADVANCED_TEXT);
    if (!r.ok) throw new Error(r.error);
    expect(r.item).toMatchObject({ rarity: "Unique", name: "Nebulis", baseType: "Void Sceptre", synthesised: true, itemLevel: 87 });
    expect(r.item.mods.map((m) => m.text)).toContain("109% increased Implicit Modifier magnitudes");
    expect(r.item.unparsed).toEqual([]);
  });

  it("reports unknown lines instead of dropping them", () => {
    const r = parsePoe1Item(TRADE_SIMPLE.replace("Item Level: 40", "Item Level: 40\nSomething New: 5"));
    if (!r.ok) throw new Error(r.error);
    expect(r.item.unparsed).toEqual(["Something New: 5"]);
  });
});

describe("line helpers", () => {
  it("extracts ranges aligned with values", () => {
    expect(extractRanges("Adds 3(2-4) to 7(6-8) Physical Damage")).toEqual({ text: "Adds 3 to 7 Physical Damage", ranges: [[2, 4], [6, 8]] });
    expect(extractRanges("+1 to Level of all Gems, 5(4-6)% more")).toEqual({ text: "+1 to Level of all Gems, 5% more", ranges: [null, [4, 6]] });
    expect(extractRanges("+78 to maximum Life")).toEqual({ text: "+78 to maximum Life", ranges: [] });
    expect(extractRanges("-10(-12--8)% to Fire Resistance").text).toBe("-10% to Fire Resistance");
  });
  it("strips trade markup", () => {
    expect(stripMarkup("Adds 10 to 14 [Fire] damage to [Attack|Attacks]")).toBe("Adds 10 to 14 Fire damage to Attacks");
  });
});
