/**
 * Travel model for routing: logical steps, never distances or directions.
 * Edges: walking between connected zones (observed transitions), travelling
 * from the part's hub (Desert Map caravan, Kingsmarch ship), waypoint/portal
 * jumps to zones the player has already been to (and their towns), and
 * waypoints between the towns of open parts. Costs are counts of these steps.
 */
import type { CampaignZone } from "../data/types";
import type { CampaignGraph } from "./graph";

export type TravelVia = "walk" | "hub" | "waypoint";

export interface TravelStep {
  zone: string;
  via: TravelVia;
}

export interface TravelPlan {
  steps: TravelStep[];
  /** Weighted step count (walk 1, hub 1, waypoint 1.5). */
  cost: number;
}

const COST: Record<TravelVia, number> = { walk: 1, hub: 1, waypoint: 1.5 };

/** Shortest logical routes from `from` to every reachable zone (one Dijkstra run). */
export function travelFrom(g: CampaignGraph, from: string | null, visited: ReadonlySet<string>, openParts: ReadonlySet<string>) {
  // Unknown start (hideout, map, unknown area): you can always reach a visited town by waypoint.
  const start = from && g.zone.has(from) ? from : null;
  const dist = new Map<string, number>();
  const prev = new Map<string, { from: string | null; via: TravelVia }>();
  const queue: { id: string; d: number }[] = [];
  const push = (id: string, d: number, p: string | null, via: TravelVia) => {
    if (d < (dist.get(id) ?? Infinity)) {
      dist.set(id, d);
      prev.set(id, { from: p, via });
      queue.push({ id, d });
    }
  };
  if (start) push(start, 0, null, "walk");
  else for (const p of g.dataset.parts) if (openParts.has(p.id) && (visited.has(p.town) || p.id === "act1")) push(p.town, COST.waypoint, null, "waypoint");

  while (queue.length) {
    queue.sort((a, b) => a.d - b.d);
    const { id, d } = queue.shift()!;
    if (d > (dist.get(id) ?? Infinity)) continue;
    for (const [next, via] of neighbours(g, g.zone.get(id)!, visited, openParts)) push(next, d + COST[via], id, via);
  }

  return {
    planTo(to: string): TravelPlan | null {
      if (to === start) return { steps: [], cost: 0 };
      if (!dist.has(to)) return null;
      const steps: TravelStep[] = [];
      for (let cur: string | null = to; cur && cur !== start; ) {
        const p: { from: string | null; via: TravelVia } = prev.get(cur)!;
        steps.unshift({ zone: cur, via: p.via });
        cur = p.from;
      }
      return { steps, cost: dist.get(to)! };
    },
  };
}

function* neighbours(g: CampaignGraph, z: CampaignZone, visited: ReadonlySet<string>, openParts: ReadonlySet<string>): Generator<[string, TravelVia]> {
  const part = g.part.get(z.part)!;
  for (const c of z.connects) yield [c, "walk"];
  // Reverse walking edges (transitions are walkable both ways).
  for (const other of reverseEdges(g).get(z.id) ?? []) yield [other, "walk"];
  if (z.id === part.town) {
    for (const other of g.dataset.zones) {
      if (other.part !== z.part || other.id === z.id) continue;
      if (other.hubTravel) yield [other.id, "hub"];
      else if (visited.has(other.id)) yield [other.id, "waypoint"];
    }
    // Towns of open parts: by waypoint once visited; Interlude hubs can be travelled to as soon as they open.
    for (const p of g.dataset.parts) {
      if (p.id !== z.part && openParts.has(p.id) && (visited.has(p.town) || p.kind === "interlude")) yield [p.town, "waypoint"];
    }
  } else {
    // A portal or waypoint back to town.
    yield [part.town, "waypoint"];
  }
}

const reverse = new WeakMap<CampaignGraph, Map<string, string[]>>();
function reverseEdges(g: CampaignGraph): Map<string, string[]> {
  let m = reverse.get(g);
  if (!m) {
    m = new Map();
    for (const z of g.dataset.zones) for (const c of z.connects) m.set(c, [...(m.get(c) ?? []), z.id]);
    reverse.set(g, m);
  }
  return m;
}

/** Plain-language instruction for one step. */
export function describeStep(g: CampaignGraph, step: TravelStep): string {
  const z = g.zone.get(step.zone)!;
  if (step.via === "walk") return `Go to ${z.name}.`;
  if (step.via === "hub") {
    if (z.part === "act2") return `Take the Ardura Caravan (Desert Map) to ${z.name}.`;
    if (z.part === "act4") return `Sail from Kingsmarch to ${z.name}.`;
    return `Travel from town to ${z.name}.`;
  }
  return z.kind === "town" ? `Go back to ${z.name} (waypoint or portal).` : `Use the waypoint to ${z.name}.`;
}
