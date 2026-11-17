/**
 * "Next step" options for the current (emulated or pasted) rare item: the
 * chance that one step reaches the goal and what it costs. One-shot steps
 * (Exalt) change the item on failure; repeatable steps (locked reforges,
 * Eldritch Chaos) keep the good side, so their expected cost is cost ÷ chance.
 */
import { addChance, MAX_PER_SIDE, reforgeChance, taggedReforgeChance } from "./engine";
import { blockedTags, ELDRITCH, type EmuItem, META } from "./emulator";
import { HARVEST_REFORGES } from "./harvest";
import type { PriceTable } from "./methods";
import type { CraftingIndex } from "./pool";
import { needOf, targetsHit } from "./sampler";
import type { BenchDef, Gen, Goal, ItemSpec, ModDef } from "./types";

export interface StepResult {
  id: string;
  label: string;
  detail: string;
  chance: number;
  costPerTry: number | null;
  /** Keeps the item's good side on failure, so it can be repeated. */
  repeatable: boolean;
  avgCost: number | null;
  components: { name: string; qty: number; price: number | null }[];
  missingPrices: string[];
}

const other = (g: Gen): Gen => (g === "prefix" ? "suffix" : "prefix");

export function benchCraftFor(idx: CraftingIndex, itemClass: string, family: string): BenchDef | undefined {
  return idx.data.bench.find((b) => b.itemClasses.includes(itemClass) && idx.modById.get(b.modId)?.family === family);
}

export function nextSteps(idx: CraftingIndex, spec: ItemSpec, item: EmuItem, goal: Goal, prices: PriceTable, dominance: Gen | null): StepResult[] {
  if (item.rarity !== "rare" || !goal.targets.length) return [];
  const base = { ...spec, fixed: [] };
  const plain = idx.pool(base);
  const tierOf = (m: ModDef) => idx.tierForMod(plain, m);
  const current = item.mods.map((m) => m.mod);
  if (targetsHit(current, goal, tierOf) >= needOf(goal)) return [];

  const count = (g: Gen) => current.filter((m) => m.gen === g).length;
  const crafted = item.mods.some((m) => m.crafted);
  const blocked = blockedTags(item);
  const restricted = blocked.length ? idx.pool(base, [], blocked) : plain;
  const cls = spec.base.itemClass;
  const price = (n: string) => (n === "Chaos Orb" ? 1 : (prices[n] ?? null));
  const out: StepResult[] = [];

  const push = (id: string, label: string, detail: string, chance: number, cost: [string, number][], repeatable: boolean) => {
    if (chance <= 0) return;
    const components = cost.map(([name, qty]) => ({ name, qty, price: price(name) }));
    const missing = components.filter((c) => c.price === null).map((c) => c.name);
    const per = missing.length ? null : components.reduce((s, c) => s + c.qty * c.price!, 0);
    out.push({ id, label, detail, chance, costPerTry: per, repeatable, avgCost: per === null ? null : repeatable ? per / chance : per, components, missingPrices: missing });
  };

  // Exalted Orb
  if (count("prefix") < MAX_PER_SIDE || count("suffix") < MAX_PER_SIDE) {
    push("exalt", "Exalted Orb", "Adds one random mod", addChance(restricted, goal, tierOf, current), [["Exalted Orb", 1]], false);
  }

  // Bench "Cannot roll Attack/Caster Modifiers" (a crafted suffix) + Exalted Orb
  for (const [family, tag, label] of [
    [META.noAttack, "attack", "Cannot roll Attack Modifiers"],
    [META.noCaster, "caster", "Cannot roll Caster Modifiers"],
  ] as const) {
    const craft = benchCraftFor(idx, cls, family);
    const meta = craft && idx.modById.get(craft.modId);
    if (!craft || !meta || crafted || count("suffix") >= MAX_PER_SIDE) continue;
    const withMeta = [...current, meta];
    const room = withMeta.filter((m) => m.gen === "prefix").length < MAX_PER_SIDE || withMeta.filter((m) => m.gen === "suffix").length < MAX_PER_SIDE;
    if (!room) continue;
    const pool = idx.pool(base, [], [...blocked, tag]);
    const c = addChance(pool, goal, tierOf, withMeta);
    // Only worth it when blocking actually improves on a plain Exalt.
    if (c <= addChance(restricted, goal, tierOf, current) * 1.001) continue;
    push(`meta-exalt:${tag}`, `“${label}” + Exalt`, "Bench metamod blocks those mods, then Exalted Orb", c, [...craft.cost, ["Exalted Orb", 1]], false);
  }

  // Eldritch currency on the dominant side
  if (dominance) {
    if (count(dominance) < MAX_PER_SIDE) {
      push("eldritch-exalt", ELDRITCH.eldritchExalt.name, `Adds a ${dominance}`, addChance(restricted, goal, tierOf, current, dominance), [[ELDRITCH.eldritchExalt.name, 1]], false);
    }
    const keep = item.mods.filter((m) => m.fractured || m.mod.gen === other(dominance)).map((m) => m.mod);
    push(
      "eldritch-chaos",
      ELDRITCH.eldritchChaos.name,
      `Rerolls the ${dominance}es, keeps the ${other(dominance)}es`,
      reforgeChance(plain, goal, tierOf, keep, { lock: other(dominance) }),
      [[ELDRITCH.eldritchChaos.name, 1]],
      true,
    );
  }

  // "Prefixes / Suffixes cannot be changed" + Chaos or Harvest reforge
  for (const lock of ["prefix", "suffix"] as const) {
    const family = lock === "prefix" ? META.lockPrefixes : META.lockSuffixes;
    const craft = benchCraftFor(idx, cls, family);
    // The metamod sits on the other side and needs a free slot there.
    if (!craft || crafted || count(other(lock)) >= MAX_PER_SIDE || count(lock) === 0) continue;
    const keep = item.mods.filter((m) => m.fractured || m.mod.gen === lock).map((m) => m.mod);
    const name = lock === "prefix" ? "Lock prefixes" : "Lock suffixes";
    push(`lock-chaos:${lock}`, `${name} + Chaos`, `Rerolls the ${other(lock)}es; the metamod is recrafted each try`, reforgeChance(plain, goal, tierOf, keep, { lock }), [...craft.cost, ["Chaos Orb", 1]], true);
    const harvest = HARVEST_REFORGES.map((h) => ({ h, chance: taggedReforgeChance(plain, goal, tierOf, h.tag, keep, { lock }) }))
      .filter((x) => x.chance > 0)
      .sort((a, b) => b.chance - a.chance)
      .slice(0, 2);
    for (const { h, chance } of harvest) {
      push(`lock-harvest:${lock}:${h.tag}`, `${name} + Harvest ${h.label}`, `Rerolls the ${other(lock)}es with a guaranteed ${h.label} mod`, chance, [...craft.cost, ...h.cost], true);
    }
  }

  return out.sort((a, b) => b.chance - a.chance);
}
