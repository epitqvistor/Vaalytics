/**
 * Route Intelligence, part 2 (pure): getting back.
 * - Off route / in town / in your hideout: the shortest way to the area the guide continues in.
 * - Return trips for permanent rewards — only when the evidence says one is really needed (a point `/passives`
 *   says is missing or not taken, or an objective you finished in an earlier act and haven't handed in). A reward
 *   that only needs confirmation gets "type /passives", never a trip. The guide never sends you back otherwise.
 * Paths come from the Location Atlas planner (game connections + waypoints of areas you have entered; read-only
 * import), counted in loading screens — never travel time.
 */
import type { CampaignArea } from "@/games/poe1/location-atlas/data/types";
import { planRoute } from "@/games/poe1/location-atlas/routes";
import type { GuardianReport, RewardState } from "./guardian";
import type { Position } from "./progress";

export interface WayPlan {
  /** Areas in order, starting where you are (or at the waypoint you jump to first). */
  path: string[];
  /** Loading screens. */
  loads: number;
  /** Starts with a waypoint jump from town / hideout. */
  viaWaypoint: boolean;
  /** "estimated": waypoints count as unlocked once their area was entered (the log can't see the click). */
  confidence: "verified" | "estimated";
}

/** Best plan to `target`: walking / waypoints from `from`, or (from town or hideout) a waypoint jump first. */
export function planWay(
  areas: ReadonlyMap<string, CampaignArea>,
  visited: ReadonlySet<string>,
  from: string | null,
  target: string,
  fromHub: boolean,
): WayPlan | null {
  if (!areas.has(target)) return null;
  let best = null as WayPlan | null;
  const consider = (p: WayPlan) => {
    if (!best || p.loads < best.loads) best = p;
  };
  if (from && areas.has(from) && from !== target) {
    const r = planRoute({ areas, from, to: target, target: "area", waypoints: "unlocked", visited });
    if (r.ok)
      consider({
        path: r.route.nodes,
        loads: r.loads,
        viaWaypoint: r.route.steps.some((s) => s.kind === "waypoint"),
        confidence: r.confidence === "verified" ? "verified" : "estimated",
      });
  }
  if (fromHub) {
    // Every town and hideout has a waypoint: jump to an unlocked one, then walk.
    for (const id of visited) {
      const a = areas.get(id);
      if (!a?.waypoint) continue;
      if (id === target) {
        consider({ path: [id], loads: 1, viaWaypoint: true, confidence: "estimated" });
        continue;
      }
      const r = planRoute({ areas, from: id, to: target, target: "area", waypoints: "none", visited });
      if (r.ok) consider({ path: r.route.nodes, loads: r.loads + 1, viaWaypoint: true, confidence: "estimated" });
    }
  }
  return best;
}

/** The way back to the area the guide continues in, when you're not there. */
export function wayBack(
  areas: ReadonlyMap<string, CampaignArea>,
  visited: ReadonlySet<string>,
  position: Position,
  guideArea: string | null,
): WayPlan | null {
  if (!guideArea || position.kind === "none" || position.kind === "on-route") return null;
  if (position.kind !== "outside" && position.areaId === guideArea) return null;
  const inTown = position.kind === "town-visit" || position.kind === "outside";
  return planWay(areas, visited, position.kind === "outside" ? null : position.areaId, guideArea, inTown);
}

export interface ReturnTrip {
  reward: RewardState;
  /** Where to go: the objective area, or the town where it is handed in. */
  target: string;
  purpose: "objective" | "hand-in";
  plan: WayPlan | null;
}

/** Trips worth making for permanent rewards in acts you've left. */
export function returnTrips(
  report: GuardianReport,
  areas: ReadonlyMap<string, CampaignArea>,
  visited: ReadonlySet<string>,
  position: Position,
  currentAct: number,
): ReturnTrip[] {
  const out: ReturnTrip[] = [];
  const from = position.kind === "none" || position.kind === "outside" ? null : position.areaId;
  const fromHub = position.kind === "town-visit" || position.kind === "outside" || (from !== null && areas.get(from)?.kind === "town");
  for (const s of report.rewards) {
    const r = s.reward;
    if (s.notExpected || (r.type !== "passive-points" && r.type !== "bandit-choice") || r.act >= currentAct) continue;
    const unclaimed = s.status === "AVAILABLE" && s.stages.objectiveCompleted === "passives"; // /passives: 0
    const notHandedIn = s.status === "IN_PROGRESS" && !!s.stages.objectiveCompleted;
    const missed = s.status === "MISSED";
    if (!unclaimed && !notHandedIn && !missed) continue;
    const handIn = s.handInArea && areas.has(s.handInArea) ? s.handInArea : null;
    const purpose: ReturnTrip["purpose"] = missed && r.objectiveArea ? "objective" : "hand-in";
    const target = purpose === "objective" ? r.objectiveArea! : handIn;
    if (!target) continue;
    out.push({ reward: s, target, purpose, plan: planWay(areas, visited, from, target, fromHub) });
  }
  return out;
}
