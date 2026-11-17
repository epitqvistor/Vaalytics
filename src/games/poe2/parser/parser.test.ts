import { describe, expect, it } from "vitest";
import { parsePoe2Item } from ".";

// Constructed from the documented PoE 2 advanced-copy format (single-line
// "Requires:", rune/desecrated markers). Replace with an in-game capture when available.
const RARE = `Item Class: Rings
Rarity: Rare
Sample Coil
Sapphire Ring
--------
Requires: Level 52, 40 Int
--------
Sockets: S
--------
Item Level: 79
--------
{ Implicit Modifier — Elemental, Cold, Resistance }
+22(20-30)% to Cold Resistance (implicit)
--------
+12% to Lightning Resistance (rune)
--------
{ Prefix Modifier "Virile" (Tier: 2) — Life }
+89(85-99) to maximum Life
{ Suffix Modifier "of the Apt" (Tier: 4) — Attribute }
+24(21-24) to Intelligence
{ Desecrated Suffix Modifier "of Sample" (Tier: 1) — Elemental, Lightning, Resistance }
+31(31-35)% to Lightning Resistance (desecrated)
--------
Corrupted
`;

const CURRENCY = `Item Class: Stackable Currency
Rarity: Currency
Exalted Orb
--------
Stack Size: 3/20
--------
Augments a Rare item with a new random modifier
--------
Right click this item then left click a rare item to apply it.
`;

describe("PoE 2 parser", () => {
  it("parses a rare with requires line, rune and desecrated mods", () => {
    const r = parsePoe2Item(RARE);
    if (!r.ok) throw new Error(r.error);
    const it = r.item;
    expect(it.game).toBe("poe2");
    expect(it).toMatchObject({ name: "Sample Coil", baseType: "Sapphire Ring", itemLevel: 79, sockets: "S", corrupted: true });
    expect(it.links).toBeUndefined();
    expect(it.requirements).toEqual({ level: 52, str: undefined, dex: undefined, int: 40 });
    expect(it.mods.map((m) => [m.kind, m.text])).toEqual([
      ["implicit", "+22% to Cold Resistance"],
      ["rune", "+12% to Lightning Resistance"],
      ["explicit", "+89 to maximum Life"],
      ["explicit", "+24 to Intelligence"],
      ["desecrated", "+31% to Lightning Resistance"],
    ]);
    expect(it.mods[2]).toMatchObject({ tier: 2, generation: "prefix", ranges: [[85, 99]] });
    expect(it.mods[4]).toMatchObject({ generation: "suffix", tier: 1 });
    expect(it.unparsed).toEqual([]);
  });

  it("parses currency", () => {
    const r = parsePoe2Item(CURRENCY);
    if (!r.ok) throw new Error(r.error);
    expect(r.item).toMatchObject({ rarity: "Currency", baseType: "Exalted Orb", stackSize: { current: 3, max: 20 } });
  });
});
