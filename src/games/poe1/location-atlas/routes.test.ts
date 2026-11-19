import { describe, expect, it } from "vitest";
import { shortestRoute, type RouteMove } from "@/shared/map/route";
import { loadDataset } from "./data";
import { planRoute, type RouteRequest } from "./routes";

const { dataset } = await loadDataset();
const areas = new Map(dataset.acts.flatMap((a) => a.areas).map((a) => [a.id, a]));
const id = (name: string, act?: number) => [...areas.values()].find((a) => a.name === name && (act === undefined || a.act === act))!.id;
const names = (ids: string[]) => ids.map((i) => areas.get(i)!.name);
const req = (p: Partial<RouteRequest>): RouteRequest => ({ areas, from: null, to: null, target: "area", waypoints: "none", visited: new Set(), ...p });

describe("shared router", () => {
  const g: Record<string, RouteMove[]> = {
    a: [{ to: "b", kind: "x", cost: 1 }, { to: "c", kind: "x", cost: 5 }],
    b: [{ to: "c", kind: "x", cost: 1 }],
    c: [],
    d: [{ to: "a", kind: "x", cost: 1 }],
  };
  const moves = (n: string) => g[n] ?? [];

  it("finds the cheapest route and returns null when unreachable", () => {
    expect(shortestRoute("a", (n) => n === "c", moves)).toEqual({
      nodes: ["a", "b", "c"],
      steps: [{ from: "a", to: "b", kind: "x" }, { from: "b", to: "c", kind: "x" }],
      cost: 2,
    });
    expect(shortestRoute("a", (n) => n === "d", moves)).toBeNull();
    expect(shortestRoute("a", (n) => n === "a", moves)?.steps).toEqual([]);
  });

  it("breaks ties the same way every time", () => {
    const tie = (n: string): RouteMove[] => (n === "s" ? [{ to: "y", kind: "k", cost: 1 }, { to: "x", kind: "k", cost: 1 }] : n === "end" ? [] : [{ to: "end", kind: "k", cost: 1 }]);
    expect(shortestRoute("s", (n) => n === "end", tie)?.nodes).toEqual(["s", "x", "end"]);
  });
});

describe("PoE 1 routes", () => {
  it("walks the game's connections", () => {
    const p = planRoute(req({ from: id("The Coast"), to: id("The Ledge") }));
    expect(p.ok && names(p.route.nodes)).toEqual(["The Coast", "The Mud Flats", "The Submerged Passage", "The Ledge"]);
    expect(p.ok && p.loads).toBe(3);
    expect(p.ok && p.confidence).toBe("verified");
  });

  it("every walking step is a real connection, across acts too", () => {
    const p = planRoute(req({ from: id("The Twilight Strand"), to: id("The Vaal Ruins") }));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const s of p.route.steps) expect(areas.get(s.from)!.connections, `${s.from}→${s.to}`).toContain(s.to);
    expect(p.route.steps.some((s) => areas.get(s.from)!.act !== areas.get(s.to)!.act)).toBe(true);
  });

  it("uses only unlocked waypoints, and says the unlock is an estimate", () => {
    const from = id("The Coast");
    const to = id("The Climb");
    const visited = new Set([from, id("The Climb"), id("The Ledge")]);
    const p = planRoute(req({ from, to, waypoints: "unlocked", visited }));
    expect(p.ok && p.route.steps.map((s) => s.kind)).toEqual(["waypoint"]);
    expect(p.ok && p.confidence).toBe("estimated");
    const locked = planRoute(req({ from, to, waypoints: "unlocked", visited: new Set([from]) }));
    expect(locked.ok && locked.route.steps.every((s) => s.kind === "walk")).toBe(true);
    const all = planRoute(req({ from, to, waypoints: "all" }));
    expect(all.ok && all.confidence).toBe("unverified");
  });

  it("finds the nearest waypoint and the act town", () => {
    const wp = planRoute(req({ from: id("The Tidal Island"), target: "waypoint" }));
    expect(wp.ok && areas.get(wp.goal)!.name).toBe("The Coast");
    const town = planRoute(req({ from: id("The Mud Flats"), target: "town" }));
    expect(town.ok && names(town.route.nodes)).toEqual(["The Mud Flats", "The Coast", "Lioneye's Watch"]);
  });

  it("refuses instead of inventing a route", () => {
    expect(planRoute(req({ to: id("The Coast") })).ok).toBe(false);
    expect(planRoute(req({ from: id("The Coast") })).ok).toBe(false);
    // Without Act 2's areas there is no walking way from Act 1 to Act 3 — none is made up.
    const gap = new Map([...areas].filter(([, a]) => a.act !== 2));
    const p = planRoute(req({ areas: gap, from: id("The Coast"), to: id("The City of Sarn") }));
    expect(p.ok).toBe(false);
    expect(!p.ok && p.reason).toMatch(/No way/);
  });
});
