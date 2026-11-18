/**
 * Route planner (pure): orders everything still worth doing in the current
 * part — or across the open Interludes — into trips. A trip is one outing to
 * a destination (an Act 2 Desert Map stop, an Act 4 island, a walking chain)
 * that does every ready objective there. Trips are chosen nearest-next by
 * logical travel steps, only once their prerequisites are met (Torn Maps
 * before Plunder's Point, gates before what they open). Not distances.
 */
import type { CampaignObjective, CampaignZone, PartId } from "../data/types";
import type { CampaignGraph } from "./graph";
import type { CampaignProgress } from "./progress";
import { modeValuer, type ModeSettings } from "./recommend";
import { describeStep, travelFrom } from "./travel";

export interface PlanTrip {
  /** Where the trip goes (island / Desert Map stop / zone chain entry). */
  destination: CampaignZone;
  /** Logical steps from the previous stop. */
  steps: string[];
  objectives: CampaignObjective[];
  /** Zones of the objectives, in order. */
  zones: CampaignZone[];
}

export interface RoutePlan {
  parts: PartId[];
  trips: PlanTrip[];
  notes: string[];
  /** Objectives that can't be planned yet (prerequisites outside the plan). */
  blocked: CampaignObjective[];
}

const INTERLUDES: PartId[] = ["int1", "int2", "int3"];

/** Parts to plan for: the open Interludes together, else the part you are in (or the furthest open act). */
export function planScope(g: CampaignGraph, progress: CampaignProgress): PartId[] {
  const here = progress.currentZone ? g.zone.get(progress.currentZone)!.part : null;
  const openInterludes = INTERLUDES.filter((p) => progress.partOpen[p]);
  if (here && INTERLUDES.includes(here)) return openInterludes;
  if (here) return [here];
  if (openInterludes.length) return openInterludes;
  const acts: PartId[] = ["act4", "act3", "act2", "act1"];
  return [acts.find((p) => progress.partOpen[p]) ?? "act1"];
}

/**
 * The hub stop a trip to `zoneId` starts at (Desert Map stop / island), found by
 * walking back along transitions; zones not reached from a hub are their own stop.
 */
function entryOf(g: CampaignGraph, zoneId: string): string {
  const reverse = new Map<string, string[]>();
  for (const z of g.dataset.zones) for (const c of z.connects) reverse.set(c, [...(reverse.get(c) ?? []), z.id]);
  const seen = new Set([zoneId]);
  const queue = [zoneId];
  while (queue.length) {
    const id = queue.shift()!;
    const z = g.zone.get(id)!;
    if (z.hubTravel) return id;
    for (const p of reverse.get(id) ?? []) {
      const pz = g.zone.get(p)!;
      if (pz.kind === "town" || pz.part !== z.part || seen.has(p)) continue;
      seen.add(p);
      queue.push(p);
    }
  }
  return zoneId;
}

export function planRoute(g: CampaignGraph, progress: CampaignProgress, settings: ModeSettings, scope: PartId[] = planScope(g, progress)): RoutePlan {
  const { value, pursued } = modeValuer(g, progress, settings);
  const statusOf = (id: string) => progress.objectives.get(id)?.status;
  const candidates = g.dataset.objectives.filter(
    (o) => scope.includes(o.part) && statusOf(o.id) !== "done" && statusOf(o.id) !== "skipped" && pursued(o),
  );
  const planned = new Set<string>();
  const doneOrPlanned = (id: string) => statusOf(id) === "done" || planned.has(id);
  const visited = new Set(progress.visited);
  const openParts = new Set(Object.entries(progress.partOpen).filter(([, v]) => v).map(([k]) => k));
  const zoneOpen = (z: CampaignZone) => visited.has(z.id) || (z.opensAfter ?? []).every(doneOrPlanned);
  const ready = (o: CampaignObjective) => !planned.has(o.id) && o.requires.every(doneOrPlanned) && zoneOpen(g.zone.get(o.zone)!);

  const trips: PlanTrip[] = [];
  let here = progress.currentZone;
  for (let guard = 0; guard < 200; guard++) {
    const now = candidates.filter(ready);
    if (!now.length) break;
    const routes = travelFrom(g, here, visited, openParts);
    // Group by trip destination; pick the nearest, ties to higher value.
    const groups = new Map<string, CampaignObjective[]>();
    for (const o of now) {
      const key = entryOf(g, o.zone);
      groups.set(key, [...(groups.get(key) ?? []), o]);
    }
    let best: { key: string; cost: number; worth: number } | null = null;
    const herePart = here ? g.zone.get(here)?.part : undefined;
    for (const [key, list] of groups) {
      // Finish the part you're in before switching (matters for the Interludes).
      const cost = (routes.planTo(key)?.cost ?? 99) + (herePart && g.zone.get(key)!.part !== herePart ? 3 : 0);
      const worth = list.reduce((sum, o) => sum + value(o), 0);
      if (!best || cost < best.cost || (cost === best.cost && worth > best.worth)) best = { key, cost, worth };
    }
    const destination = g.zone.get(best!.key)!;
    const plan = routes.planTo(destination.id);
    // Do everything that becomes ready at this destination (chains like map → boss on one island).
    const objectives: CampaignObjective[] = [];
    for (let more = true; more; ) {
      more = false;
      for (const o of candidates) {
        if (ready(o) && entryOf(g, o.zone) === destination.id) {
          planned.add(o.id);
          objectives.push(o);
          more = true;
        }
      }
    }
    const zones = [...new Set(objectives.map((o) => o.zone))].map((id) => g.zone.get(id)!);
    for (const z of zones) visited.add(z.id);
    visited.add(destination.id);
    const steps = plan ? plan.steps.map((s) => describeStep(g, s)) : [`Find ${destination.name} (no known route — the area isn't in the logged transitions).`];
    trips.push({ destination, steps, objectives, zones });
    here = zones[zones.length - 1]?.id ?? destination.id;
  }

  const notes: string[] = [];
  if (scope.includes("act4")) {
    const maps = ["a4.map-whakapanu", "a4.map-shrike", "a4.map-kin", "a4.map-kedge"];
    const left = maps.filter((m) => statusOf(m) !== "done");
    if (left.length) notes.push(`Plunder's Point needs all four Torn Maps — ${4 - left.length} of 4 confirmed so far; the plan collects the rest first.`);
    notes.push("Islands can be done in most orders; the plan picks the fewest trips back to Kingsmarch.");
  }
  if (scope.includes("act2")) notes.push("Desert Map stops open together after The Halani Gates; area levels there depend on the order you visit them.");
  if (scope.some((p) => INTERLUDES.includes(p))) {
    notes.push("The three Interludes can be done in any order. In real runs their area levels rose with each one (first ~54–56, last ~62–64), so the first is easiest.");
    notes.push("Entering an Interlude lowers your resistances — check them before its bosses.");
  }
  const blocked = candidates.filter((o) => !planned.has(o.id));
  return { parts: scope, trips, notes, blocked };
}
