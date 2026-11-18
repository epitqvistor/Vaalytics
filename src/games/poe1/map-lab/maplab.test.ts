import { describe, expect, it } from "vitest";
import { parsePoe1Item } from "../parser";
import { ADVANCED_MAP, RARE_MAP } from "./fixtures";
import { classify, isMap, isRules, mapReport, modKey, setRule } from "./maplab";

const parse = (t: string) => {
  const r = parsePoe1Item(t);
  if (!r.ok) throw new Error(r.error);
  return r.item;
};

describe("mod keys", () => {
  it("ignore rolls and signs", () => {
    expect(modKey("Monsters reflect 18% of Physical Damage")).toBe("Monsters reflect #% of Physical Damage");
    expect(modKey("Players have -12% to all maximum Resistances")).toBe("Players have #% to all maximum Resistances");
    expect(modKey("+30% Monster Physical Damage Reduction")).toBe("#% Monster Physical Damage Reduction");
  });
});

describe("map report", () => {
  it("groups mods by default rules and lists rewards verbatim", () => {
    const map = parse(RARE_MAP);
    expect(isMap(map)).toBe(true);
    const r = mapReport(map, {});
    expect([r.base, r.tier, r.corrupted]).toEqual(["Strand Map", 16, true]);
    expect(r.rewards).toEqual([
      { name: "Item Quantity", value: "+87%" },
      { name: "Item Rarity", value: "+45%" },
      { name: "Monster Pack Size", value: "+28%" },
      { name: "Quality", value: "+20%" },
    ]);
    expect(r.verdict).toBe("breaking");
    expect(r.counts).toEqual({ breaking: 2, danger: 1, ok: 3 });
    expect(r.mods[0]!.source).toBe("default");
  });

  it("shows the 3.30 Atlas Drops property as a reward", () => {
    const map = parse(RARE_MAP.replace("Item Quantity: +87%", "Atlas Drops: +87%"));
    expect(mapReport(map, {}).rewards[0]).toEqual({ name: "Atlas Drops", value: "+87%" });
  });

  it("user rules win over defaults", () => {
    const map = parse(RARE_MAP);
    let rules = setRule({}, "Monsters reflect #% of Physical Damage", "ok");
    rules = setRule(rules, "Players cannot Regenerate Life, Mana or Energy Shield", "danger");
    rules = setRule(rules, "Monsters have #% increased Area of Effect", "danger");
    const r = mapReport(map, rules);
    expect(r.verdict).toBe("danger");
    expect(r.counts).toEqual({ breaking: 0, danger: 3, ok: 3 });
    expect(isRules(rules)).toBe(true);
  });

  it("keeps prefix/suffix from an advanced copy", () => {
    const r = mapReport(parse(ADVANCED_MAP), {});
    expect(r.mods.map((m) => [m.generation, m.severity])).toEqual([
      ["suffix", "danger"],
      ["prefix", "ok"],
    ]);
  });
});

describe("rules", () => {
  it("'fine' without a default removes the rule; with a default it overrides it", () => {
    expect(setRule({ a: "danger" }, "a", "ok")).toEqual({});
    expect(setRule({}, "Monsters reflect #% of Elemental Damage", "ok")).toEqual({ "Monsters reflect #% of Elemental Damage": "ok" });
    expect(classify("Monsters reflect 13% of Elemental Damage", { "Monsters reflect #% of Elemental Damage": "ok" }).source).toBe("rule");
  });

  it("validates stored rules", () => {
    expect(isRules({ x: "danger" })).toBe(true);
    expect(isRules({ x: "bad" })).toBe(false);
    expect(isRules([])).toBe(false);
  });
});
