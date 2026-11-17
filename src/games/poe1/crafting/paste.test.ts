import { describe, expect, it } from "vitest";
import fixture from "./fixtures/poe1-subset.json";
import { matchMod, pobText, specFromText, template } from "./paste";
import { CraftingIndex } from "./pool";
import type { CraftingData } from "./types";

const idx = new CraftingIndex(fixture as unknown as CraftingData);

const RING = `Item Class: Rings
Rarity: Rare
Doom Loop
Two-Stone Ring
--------
Requirements:
Level: 36
--------
Item Level: 84
--------
+14% to Fire and Lightning Resistances (implicit)
--------
+62 to maximum Life (fractured)
+38% to Cold Resistance
--------
Fractured Item
--------
Shaper Item
`;

describe("crafting paste", () => {
  it("builds a template regex with ranges", () => {
    const t = template("+(3-9) to maximum Life");
    expect(t.ranges).toEqual([[3, 9]]);
    expect(t.re.test("+7 to maximum Life")).toBe(true);
    expect(template("Adds (1-2) to (3-4) Fire Damage").re.test("Adds 2 to 4 Fire Damage")).toBe(true);
  });

  it("identifies the tier of a rolled line", () => {
    const m = matchMod(idx, "+62 to maximum Life")!;
    expect(m.family).toBe("IncreasedLife");
    expect(m.id).toBe("IncreasedLife4"); // +(55-69)
  });

  it("reads base, item level, influence and fractured mods", () => {
    const r = specFromText(idx, RING);
    if ("error" in r) throw new Error(r.error);
    expect(r.spec.base.name).toBe("Two-Stone Ring");
    expect(r.spec.base.implicits[0]).toContain("Fire and Lightning");
    expect(r.spec.ilvl).toBe(84);
    expect(r.spec.influences).toEqual(["Shaper"]);
    expect(r.spec.fixed.map((m) => m.family)).toEqual(["IncreasedLife"]);
    expect(pobText(r.spec, r.item)).toBe(RING.trim());
  });

  it("rejects uniques and unsupported classes", () => {
    expect("error" in specFromText(idx, RING.replace("Rarity: Rare", "Rarity: Unique"))).toBe(true);
    expect("error" in specFromText(idx, RING.replace("Item Class: Rings", "Item Class: Jewels"))).toBe(true);
  });

  it("exports a base for Path of Building", () => {
    const base = idx.data.bases.find((b) => b.name === "Hubris Circlet")!;
    const text = pobText({ base, ilvl: 86, influences: ["Elder"], fixed: [] }, null);
    expect(text.split("\n").slice(0, 5)).toEqual(["Rarity: RARE", "Crafted Item", "Hubris Circlet", "Item Level: 86", "Elder Item"]);
  });
});

it("prefers mods that roll on the pasted base", () => {
  const r = specFromText(idx, RING);
  if ("error" in r) throw new Error(r.error);
  expect(r.spec.fixed[0]!.id).toBe("IncreasedLife4");
});
