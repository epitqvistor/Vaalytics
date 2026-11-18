/**
 * Missed Objectives Recovery (pure). Finds reward-bearing objectives the player
 * has moved past without a confirmation, explains each, and builds one
 * efficient return trip. "Missed" is never asserted as fact: the log can't
 * prove most claims, so every item can be confirmed with one click instead.
 */
import type { CampaignObjective, CampaignReward, CampaignZone, PartId } from "../data/types";
import type { CampaignGraph } from "./graph";
import type { CampaignProgress } from "./progress";
import { describeStep, travelFrom } from "./travel";

export type MissedReason = "skipped" | "left-behind" | "act-finished";

export interface MissedObjective {
  objective: CampaignObjective;
  zone: CampaignZone;
  rewards: CampaignReward[];
  reason: MissedReason;
  explanation: string;
  /** Prerequisites not done (shown instead of a route while locked). */
  missingPrerequisites: CampaignObjective[];
  /** Logical steps from where the player is now. */
  route: string[];
  routeCost: number | null;
  advice: "now" | "later";
  adviceText: string;
}

export interface RecoveryStop {
  zone: CampaignZone;
  objectives: CampaignObjective[];
  steps: string[];
}

const PART_ORDER: PartId[] = ["act1", "act2", "act3", "act4", "int1", "int2", "int3"];
const NEAR = 3;

export function missedObjectives(g: CampaignGraph, progress: CampaignProgress): MissedObjective[] {
  const status = (id: string) => progress.objectives.get(id)?.status;
  const openParts = new Set(PART_ORDER.filter((p) => progress.partOpen[p]));
  // Parts the player has finished: a part they gate is open.
  const finished = new Set(
    g.dataset.parts.filter((q) => progress.partOpen[q.id]).flatMap((q) => q.opensAfter.map((id) => g.objective.get(id)?.part)).filter((p): p is PartId => !!p),
  );
  // Highest area level the player has reached per part (visited zones).
  const reached = new Map<PartId, number>();
  for (const id of progress.visited) {
    const z = g.zone.get(id)!;
    const lv = Math.max(0, ...z.levels);
    reached.set(z.part, Math.max(reached.get(z.part) ?? 0, lv));
  }
  const routes = travelFrom(g, progress.currentZone, progress.visited, openParts);

  const out: MissedObjective[] = [];
  for (const o of g.dataset.objectives) {
    const rewards = o.rewards.map((r) => g.reward.get(r)!).filter((r) => r.permanent);
    if (rewards.length === 0) continue;
    const st = status(o.id);
    if (st === "done") continue;
    const zone = g.zone.get(o.zone)!;
    let reason: MissedReason | null = null;
    let explanation = "";
    if (st === "skipped") {
      reason = "skipped";
      explanation = "You skipped it.";
    } else if (finished.has(o.part)) {
      reason = "act-finished";
      explanation = `You've moved on from ${g.part.get(o.part)!.name} without a confirmation.`;
    } else if (progress.visited.has(zone.id) && progress.currentZone !== zone.id && (reached.get(o.part) ?? 0) > Math.max(0, ...zone.levels) + 1) {
      reason = "left-behind";
      explanation = `You were in ${zone.name} and went on to higher-level areas; it isn't confirmed done.`;
    }
    if (!reason) continue;

    const missingPrerequisites = o.requires.filter((r) => status(r) !== "done").map((r) => g.objective.get(r)!);
    const plan = routes.planTo(zone.id);
    const advice: MissedObjective["advice"] = plan && plan.cost <= NEAR && missingPrerequisites.length === 0 ? "now" : "later";
    out.push({
      objective: o,
      zone,
      rewards,
      reason,
      explanation,
      missingPrerequisites,
      route: plan ? plan.steps.map((s) => describeStep(g, s)) : [],
      routeCost: plan?.cost ?? null,
      advice,
      adviceText:
        missingPrerequisites.length > 0
          ? `First: ${missingPrerequisites.map((p) => p.title).join("; ")}.`
          : advice === "now"
            ? "Close by — worth doing now."
            : "Further away — best done in one return trip with the others.",
    });
  }
  // Highest-value first, then nearest.
  const weight = (m: MissedObjective) => (m.rewards.some((r) => r.category === "passive" || r.category === "spirit" || r.category === "ascendancy") ? 0 : 1);
  return out.sort((a, b) => weight(a) - weight(b) || (a.routeCost ?? 99) - (b.routeCost ?? 99));
}

/**
 * One return trip: visit the zones of the missed objectives (prerequisites met)
 * in nearest-next order, using logical travel steps from each stop.
 */
export function recoveryRoute(g: CampaignGraph, progress: CampaignProgress, missed: readonly MissedObjective[]): RecoveryStop[] {
  const openParts = new Set(PART_ORDER.filter((p) => progress.partOpen[p]));
  const byZone = new Map<string, CampaignObjective[]>();
  for (const m of missed) {
    if (m.missingPrerequisites.length) continue;
    byZone.set(m.zone.id, [...(byZone.get(m.zone.id) ?? []), m.objective]);
  }
  const stops: RecoveryStop[] = [];
  let here = progress.currentZone;
  while (byZone.size) {
    const routes = travelFrom(g, here, progress.visited, openParts);
    let best: { zone: string; cost: number; steps: string[] } | null = null;
    for (const zoneId of byZone.keys()) {
      const plan = routes.planTo(zoneId);
      const cost = plan?.cost ?? Infinity;
      if (!best || cost < best.cost) best = { zone: zoneId, cost, steps: plan ? plan.steps.map((s) => describeStep(g, s)) : [`Find your way to ${g.zone.get(zoneId)!.name}.`] };
    }
    stops.push({ zone: g.zone.get(best!.zone)!, objectives: byZone.get(best!.zone)!, steps: best!.steps });
    byZone.delete(best!.zone);
    here = best!.zone;
  }
  return stops;
}
