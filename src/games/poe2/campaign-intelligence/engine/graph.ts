/**
 * Indexed, immutable view of a dataset, built once per dataset (cached by the
 * caller). Lookups the engine needs on every event are O(1).
 */
import type { CampaignDataset, CampaignObjective, CampaignPart, CampaignReward, CampaignZone, PartId, QuestItem } from "../data/types";

export interface CampaignGraph {
  dataset: CampaignDataset;
  zone: Map<string, CampaignZone>;
  objective: Map<string, CampaignObjective>;
  reward: Map<string, CampaignReward>;
  item: Map<string, QuestItem>;
  part: Map<PartId, CampaignPart>;
  /** Log area id → zone. */
  byAreaId: Map<string, CampaignZone>;
  /** Normalised display name → zone (fallback when the area id is unknown). */
  byName: Map<string, CampaignZone>;
  /** Objectives per zone (done there or turned in there), in dataset order. */
  objectivesInZone: Map<string, CampaignObjective[]>;
  /** Dataset order index (stable tie-breaker). */
  order: Map<string, number>;
}

export const normaliseName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function buildGraph(dataset: CampaignDataset): CampaignGraph {
  const byAreaId = new Map<string, CampaignZone>();
  const byName = new Map<string, CampaignZone>();
  for (const z of dataset.zones) {
    for (const a of z.areaIds) byAreaId.set(a, z);
    byName.set(normaliseName(z.name), z);
  }
  const objectivesInZone = new Map<string, CampaignObjective[]>();
  const push = (zone: string, o: CampaignObjective) => {
    const list = objectivesInZone.get(zone) ?? [];
    if (!list.includes(o)) list.push(o);
    objectivesInZone.set(zone, list);
  };
  for (const o of dataset.objectives) {
    push(o.zone, o);
    if (o.turnIn) push(o.turnIn, o);
  }
  return {
    dataset,
    zone: new Map(dataset.zones.map((z) => [z.id, z])),
    objective: new Map(dataset.objectives.map((o) => [o.id, o])),
    reward: new Map(dataset.rewards.map((r) => [r.id, r])),
    item: new Map(dataset.items.map((i) => [i.id, i])),
    part: new Map(dataset.parts.map((p) => [p.id, p])),
    byAreaId,
    byName,
    objectivesInZone,
    order: new Map(dataset.objectives.map((o, i) => [o.id, i])),
  };
}

/** Zone for a log area: by internal id first, then by display name. `null` = not a campaign zone we know. */
export function zoneFor(g: CampaignGraph, areaId: string, name?: string | null): CampaignZone | null {
  return g.byAreaId.get(areaId) ?? (name ? g.byName.get(normaliseName(name)) ?? null : null);
}

/** Does this log area id look like a campaign area (acts `G<n>_…`, interludes `P<n>_…`)? */
export const isCampaignAreaId = (areaId: string) => /^[GP]\d+_/.test(areaId);
