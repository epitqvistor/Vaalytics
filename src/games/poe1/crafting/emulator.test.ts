import { describe, expect, it } from "vitest";
import { Emulator, rollText, type EmuItem } from "./emulator";
import fixture from "./fixtures/poe1-subset.json";
import { compareMethods } from "./methods";
import { runMonteCarlo } from "./montecarlo";
import { CraftingIndex, families } from "./pool";
import { rng } from "./simulate";
import type { CraftingData, Goal, ItemSpec } from "./types";

const data = fixture as unknown as CraftingData;
const idx = new CraftingIndex(data);
const circlet = data.bases.find((b) => b.name === "Hubris Circlet")!;
const spec: ItemSpec = { base: circlet, ilvl: 86, influences: [], fixed: [] };
const normal: EmuItem = { rarity: "normal", mods: [] };

const ok = (x: EmuItem | { error: string }): EmuItem => {
  if ("error" in x) throw new Error(x.error);
  return x;
};
const sides = (i: EmuItem) => ({ p: i.mods.filter((m) => m.mod.gen === "prefix").length, s: i.mods.filter((m) => m.mod.gen === "suffix").length });

describe("value rolls", () => {
  it("rolls inside the range, keeping decimals", () => {
    const r = rng(1);
    for (let i = 0; i < 200; i++) {
      const v = Number(/\+(\d+) to/.exec(rollText("+(3-9) to maximum Life", r))![1]);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
      expect(rollText("Regenerate (48.1-64) Life per second", r)).toMatch(/^Regenerate \d+\.\d Life per second$/);
    }
  });
});

describe("currency emulator", () => {
  const emu = new Emulator(idx, spec);
  const r = rng(42);

  it("follows rarity rules", () => {
    expect("error" in emu.apply(normal, { kind: "chaos" }, r)).toBe(true);
    const magic = ok(emu.apply(normal, { kind: "transmute" }, r));
    expect(magic.rarity).toBe("magic");
    expect(magic.mods.length).toBeGreaterThanOrEqual(1);
    expect(sides(magic).p).toBeLessThanOrEqual(1);
    expect(sides(magic).s).toBeLessThanOrEqual(1);
    const rare = ok(emu.apply(magic.mods.length === 1 ? ok(emu.apply(magic, { kind: "augmentation" }, r)) : magic, { kind: "regal" }, r));
    expect(rare.rarity).toBe("rare");
    expect(rare.mods.length).toBe(3);
  });

  it("rerolls rares within 4–6 mods and 3/3 sides, groups unique", () => {
    let item = ok(emu.apply(normal, { kind: "alchemy" }, r));
    for (let i = 0; i < 300; i++) {
      item = ok(emu.apply(item, { kind: "chaos" }, r));
      expect(item.mods.length).toBeGreaterThanOrEqual(4);
      expect(item.mods.length).toBeLessThanOrEqual(6);
      expect(sides(item).p).toBeLessThanOrEqual(3);
      expect(sides(item).s).toBeLessThanOrEqual(3);
      const groups = item.mods.flatMap((m) => m.mod.groups);
      expect(new Set(groups).size).toBe(groups.length);
    }
  });

  it("keeps fractured mods through chaos, annul and scour", () => {
    const life = families(idx.pool(spec)).find((f) => f.gen === "prefix" && /to maximum Life$/.test(f.best.mod.text))!.best.mod;
    const start: EmuItem = { rarity: "rare", mods: [{ mod: life, text: "+100 to maximum Life", fractured: true }] };
    let item = start;
    for (let i = 0; i < 50; i++) {
      item = ok(emu.apply(item, { kind: "chaos" }, r));
      expect(item.mods[0]).toEqual(start.mods[0]);
      expect(item.mods.filter((m) => m.mod.family === life.family)).toHaveLength(1);
    }
    while (item.mods.length > 1) item = ok(emu.apply(item, { kind: "annulment" }, r));
    expect("error" in emu.apply(item, { kind: "annulment" }, r)).toBe(true);
    expect(ok(emu.apply(item, { kind: "scouring" }, r))).toEqual({ rarity: "rare", mods: start.mods });
  });

  it("essences guarantee their mod; magic items are refused", () => {
    const greed = data.essences.find((e) => e.name === "Deafening Essence of Greed")!;
    const mod = emu.essenceMod(greed)!;
    for (let i = 0; i < 20; i++) expect(ok(emu.apply(normal, { kind: "essence", essence: greed }, r)).mods.some((m) => m.mod.id === mod.id)).toBe(true);
    const magic = ok(emu.apply(normal, { kind: "transmute" }, r));
    expect("error" in emu.apply(magic, { kind: "essence", essence: greed }, r)).toBe(true);
  });
});

describe("monte carlo", () => {
  it("measures a chance close to the model and orders percentiles", async () => {
    const pool = idx.pool(spec);
    const life = families(pool).find((f) => f.gen === "prefix" && /to maximum Life$/.test(f.best.mod.text))!;
    const goal: Goal = { targets: [{ family: life.family, gen: "prefix", maxTier: 4 }], need: 1 };
    const prices = { "Orb of Alteration": 0.1, "Orb of Augmentation": 0.05 };
    const methods = compareMethods(idx, { spec, goal, prices });
    for (const id of ["chaos", "alt"]) {
      const method = methods.find((m) => m.id === id)!;
      const res = (await runMonteCarlo(idx, { spec, goal, method, prices, budgetMs: 10_000, maxAttempts: 20_000, crafts: 2000, seed: 3 }, () => {}, () => false))!;
      expect(res.attempts).toBe(20_000);
      expect(res.usedModel).toBe(false);
      const se = Math.sqrt((res.chance * (1 - res.chance)) / res.attempts);
      expect(Math.abs(res.chance - method.chance)).toBeLessThan(4 * se + 0.05 * method.chance);
      expect(res.cost).not.toBeNull();
      const c = res.cost!;
      expect(c.p25).toBeLessThanOrEqual(c.p50);
      expect(c.p50).toBeLessThanOrEqual(c.p75);
      expect(c.p75).toBeLessThanOrEqual(c.p90);
      expect(res.histogram.reduce((s, b) => s + b.count, 0)).toBeGreaterThan(1900);
    }
  });
});
