/**
 * Route Intelligence (PoE 1, pure): the shortest way between campaign areas over the
 * game's own connections (RePoE `connections`, one-way exits respected) and waypoint
 * travel. Nothing else is assumed — no logout, town portal or travel time — so a
 * route either exists in the data or the planner says it doesn't.
 * Cost = loading screens (one per area change or waypoint jump).
 */
import { shortestRoute, type Route, type RouteMove } from "@/shared/map/route";
import type { CampaignArea, Confidence } from "./data/types";

export type MoveKind = "walk" | "waypoint";
/** `unlocked` = waypoints of areas you've entered (from Client.txt); `all` = assume every one; `none` = walk only. */
export type WaypointMode = "unlocked" | "all" | "none";
export type RouteTarget = "area" | "waypoint" | "town";

export const WAYPOINT_MODES: { value: WaypointMode; label: string }[] = [
  { value: "unlocked", label: "My waypoints" },
  { value: "all", label: "All waypoints" },
  { value: "none", label: "Walk only" },
];
export const ROUTE_TARGETS: { value: RouteTarget; label: string }[] = [
  { value: "area", label: "Chosen area" },
  { value: "waypoint", label: "Nearest waypoint" },
  { value: "town", label: "Act town" },
];

export interface RouteRequest {
  areas: ReadonlyMap<string, CampaignArea>;
  from: string | null;
  /** Used by the `area` target. */
  to: string | null;
  target: RouteTarget;
  waypoints: WaypointMode;
  /** Areas entered (Client.txt); their waypoints count as unlocked in `unlocked` mode. */
  visited: ReadonlySet<string>;
}

export type RoutePlan =
  | {
      ok: true;
      route: Route<MoveKind>;
      goal: string;
      /** Loading screens on the way (area changes + waypoint jumps). */
      loads: number;
      /** The weakest fact the route relies on. */
      confidence: Confidence;
      notes: string[];
    }
  | { ok: false; reason: string };

/** Waypoint jumps cost a hair more than walking one area, so ties prefer walking. */
const WALK = 1;
const JUMP = 1.01;

export function planRoute(r: RouteRequest): RoutePlan {
  const start = r.from ? r.areas.get(r.from) : undefined;
  if (!start) return { ok: false, reason: "Choose where the route starts — enter an area in game, or pick one." };
  const goalId = r.target === "area" ? r.to : null;
  if (r.target === "area" && (!goalId || !r.areas.has(goalId))) return { ok: false, reason: "Choose the area to go to." };
  const town = start.town ?? (start.kind === "town" ? start.id : null);
  if (r.target === "town" && !town) return { ok: false, reason: `The game data names no town for ${start.name}.` };

  const unlocked = (a: CampaignArea) => a.waypoint && (r.waypoints === "all" || (r.waypoints === "unlocked" && r.visited.has(a.id)));
  const jumps = r.waypoints === "none" ? [] : [...r.areas.values()].filter(unlocked).map((a) => a.id).sort();
  const moves = (id: string): RouteMove<MoveKind>[] => {
    const a = r.areas.get(id);
    if (!a) return [];
    const walk = a.connections.filter((c) => r.areas.has(c)).map((to) => ({ to, kind: "walk" as const, cost: WALK }));
    // Any waypoint you stand by can be used (reaching it unlocks it); the destination must be unlocked.
    return a.waypoint && jumps.length ? [...walk, ...jumps.filter((j) => j !== id).map((to) => ({ to, kind: "waypoint" as const, cost: JUMP }))] : walk;
  };
  const isGoal = (id: string) =>
    r.target === "area" ? id === goalId : r.target === "town" ? id === town : (r.areas.get(id)?.waypoint ?? false);

  const route = shortestRoute(start.id, isGoal, moves);
  const goalName = r.target === "area" ? r.areas.get(goalId!)!.name : r.target === "town" ? (r.areas.get(town!)?.name ?? "the town") : "a waypoint";
  if (!route) {
    const hint = r.waypoints === "all" ? "" : r.waypoints === "none" ? " Try allowing waypoints." : " Try “All waypoints”.";
    return { ok: false, reason: `No way from ${start.name} to ${goalName} in the game's connections with these settings.${hint}` };
  }

  const usesJump = route.steps.some((s) => s.kind === "waypoint");
  const notes = ["Counts loading screens, not travel time. Logout and town portals aren't used."];
  let confidence: Confidence = "verified";
  if (usesJump && r.waypoints === "unlocked") {
    confidence = "estimated";
    notes.push("A waypoint counts as unlocked once you've entered its area; the log doesn't say whether you clicked it.");
  } else if (usesJump && r.waypoints === "all") {
    confidence = "unverified";
    notes.push("Assumes every waypoint on the way is unlocked.");
  }
  if (route.steps.some((s) => s.kind === "walk" && !r.areas.get(s.to)?.connections.includes(s.from)))
    notes.push("Uses a one-way exit — you can't walk back the same way.");
  return { ok: true, route, goal: route.nodes[route.nodes.length - 1]!, loads: route.steps.length, confidence, notes };
}
