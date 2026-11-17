/**
 * Harvest (Horticrafting) reforges that guarantee a modifier with a tag.
 * RePoE has no Harvest data; costs from poedb.tw/us/Horticrafting (checked
 * 2026-11-17, PoE 1 3.29). Prices of Lifeforce / Rancour come from poe.ninja.
 * "More/less likely" reforges are not modelled: their weight multipliers are
 * not published.
 */
export interface HarvestReforge {
  /** Mod tag (RePoE implicit_tags). */
  tag: string;
  label: string;
  cost: [name: string, qty: number][];
}

const WILD = "Wild Crystallised Lifeforce";
const VIVID = "Vivid Crystallised Lifeforce";
const PRIMAL = "Primal Crystallised Lifeforce";
const RANCOUR = "Crystallised Rancour";

export const HARVEST_REFORGES: readonly HarvestReforge[] = [
  { tag: "fire", label: "Fire", cost: [[WILD, 50]] },
  { tag: "cold", label: "Cold", cost: [[VIVID, 50]] },
  { tag: "lightning", label: "Lightning", cost: [[PRIMAL, 50]] },
  { tag: "physical", label: "Physical", cost: [[VIVID, 50]] },
  { tag: "life", label: "Life", cost: [[WILD, 75]] },
  { tag: "defences", label: "Defence", cost: [[PRIMAL, 75]] },
  { tag: "chaos", label: "Chaos", cost: [[VIVID, 100]] },
  { tag: "attack", label: "Attack", cost: [[WILD, 75]] },
  { tag: "caster", label: "Caster", cost: [[PRIMAL, 75]] },
  { tag: "speed", label: "Speed", cost: [[VIVID, 150]] },
  { tag: "critical", label: "Critical", cost: [[PRIMAL, 150]] },
  { tag: "minion", label: "Minion", cost: [[PRIMAL, 200], [RANCOUR, 3]] },
  { tag: "elemental", label: "Elemental", cost: [[WILD, 200], [RANCOUR, 1]] },
  { tag: "attribute", label: "Attribute", cost: [[VIVID, 200], [RANCOUR, 2]] },
  { tag: "mana", label: "Mana", cost: [[PRIMAL, 200], [RANCOUR, 2]] },
  { tag: "drop", label: "Drop", cost: [[VIVID, 200], [RANCOUR, 1]] },
];

export const harvestByTag = (tag: string) => HARVEST_REFORGES.find((h) => h.tag === tag);
