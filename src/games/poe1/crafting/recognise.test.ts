import { describe, expect, it } from "vitest";
import fixture from "./fixtures/poe1-subset.json";
import { emuFromPaste, specFromText } from "./paste";
import { CraftingIndex } from "./pool";
import { lineMatchesKey } from "./recognise";
import type { CraftingData } from "./types";

const idx = new CraftingIndex(fixture as unknown as CraftingData);

function load(text: string) {
  const r = specFromText(idx, text);
  if ("error" in r) throw new Error(r.error);
  return emuFromPaste(idx, r.spec, r.item);
}

// Shaper/Elder helmet with Elevated and hybrid "Socketed Gems are Supported by" mods
// (the lines from a user report), plus a bench craft.
const HELMET = `Item Class: Helmets
Rarity: Rare
Doom Visor
Hubris Circlet
--------
Item Level: 86
--------
14% increased Area of Effect
Socketed Gems are Supported by Level 25 Increased Area of Effect
Socketed Gems are Supported by Level 25 Less Duration
19% increased Effect of Cold Ailments
Socketed Gems are Supported by Level 20 Hypothermia
Socketed Spells have +4% to Critical Strike Chance
+25 to Strength and Intelligence (crafted)
--------
Shaper Item
Elder Item
`;

// Same idea in advanced copy (Ctrl+Alt+C): a veiled mod and an unknown line with a header.
const ADVANCED = `Item Class: Helmets
Rarity: Rare
Doom Visor
Hubris Circlet
--------
Item Level: 86
--------
{ Prefix Modifier "Chosen" — Skill }
9% increased Area of Effect
+2 to Level of Socketed AoE Gems
{ Prefix Modifier "Elevated Elder's" }
Socketed Gems are Supported by Level 25 Less Duration
{ Suffix Modifier "of Mystery" }
Something no data file knows about
--------
Shaper Item
Elder Item
`;

describe("recognising pasted mods", () => {
  it("matches support-gem lines by their stat key", () => {
    expect(lineMatchesKey("Socketed Gems are Supported by Level 25 Less Duration", "support:reduced duration")).toBe(true);
    expect(lineMatchesKey("Socketed Gems are Supported by Level 25 Increased Area of Effect", "support:increased area")).toBe(true);
    expect(lineMatchesKey("Socketed Gems are Supported by Level 20 Hypothermia", "support:reduced duration")).toBe(false);
  });

  it("carries Elevated, hybrid and crafted mods into the emulator", () => {
    const r = load(HELMET);
    expect(r.dropped).toEqual([]);
    expect(r.unknown).toEqual([]);
    const byText = (t: string) => r.item.mods.find((m) => m.text.includes(t))!;
    // Hybrid: AoE % + its support line form one mod.
    expect(byText("Increased Area of Effect").text).toBe("14% increased Area of Effect\nSocketed Gems are Supported by Level 25 Increased Area of Effect");
    expect(byText("Hypothermia").text).toContain("Effect of Cold Ailments");
    expect(byText("Less Duration").mod.gen).toBe("prefix");
    expect(byText("+4% to Critical Strike Chance").mod.id).toContain("Maven");
    const crafted = byText("Strength and Intelligence");
    expect(crafted.crafted).toBe(true);
    expect(r.item.mods.filter((m) => m.mod.gen === "prefix").length).toBeLessThanOrEqual(3);
    expect(r.item.mods.filter((m) => m.mod.gen === "suffix").length).toBeLessThanOrEqual(3);
  });

  it("recognises veiled mods and keeps unknown lines that have a header", () => {
    const r = load(ADVANCED);
    expect(r.dropped).toEqual([]);
    expect(r.item.mods.find((m) => m.text.includes("Socketed AoE Gems"))!.text).toBe("9% increased Area of Effect\n+2 to Level of Socketed AoE Gems");
    expect(r.unknown).toEqual(["Something no data file knows about"]);
    expect(r.item.mods.find((m) => m.mod.id.startsWith("unknown:"))!.mod.gen).toBe("suffix");
  });

  it("lists lines it can't place when the copy has no prefix/suffix info", () => {
    const r = load(HELMET.replace("+25 to Strength and Intelligence (crafted)", "Something no data file knows about"));
    expect(r.dropped).toEqual(["Something no data file knows about"]);
  });
});
