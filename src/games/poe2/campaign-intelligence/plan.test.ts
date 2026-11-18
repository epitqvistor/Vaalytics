import { describe, expect, it } from "vitest";
import type { CampaignBuildStats } from "@/core/ipc/commands";
import { CAMPAIGN_0_5_5 } from "./data/0.5.5";
import { buildHints } from "./engine/build";
import { buildGraph } from "./engine/graph";
import { type CampaignEvent, type ManualMark, deriveProgress } from "./engine/progress";
import { planRoute, planScope } from "./engine/plan";
import { DEFAULT_SETTINGS, recommend } from "./engine/recommend";

const g = buildGraph(CAMPAIGN_0_5_5);
let t = 0;
const zone = (areaId: string): CampaignEvent => ({ kind: "zone", at: ++t, areaId });
const done = (...ids: string[]): ManualMark[] => ids.map((objective) => ({ objective, mark: "done", at: 1 }));
const order = (plan: ReturnType<typeof planRoute>) => plan.trips.flatMap((tr) => tr.objectives.map((o) => o.id));

describe("route planner", () => {
  it("Act 4: collects all four Torn Maps before Plunder's Point, one trip per island", () => {
    const p = deriveProgress(g, [zone("G4_town")]);
    const plan = planRoute(g, p, DEFAULT_SETTINGS);
    expect(plan.parts).toEqual(["act4"]);
    const ids = order(plan);
    const pp = ids.indexOf("a4.plunders-point");
    for (const m of ["a4.map-whakapanu", "a4.map-shrike", "a4.map-kin", "a4.map-kedge"]) expect(ids.indexOf(m)).toBeLessThan(pp);
    // Whakapanu's map, Great White and Diamora (Singing Caverns) are one trip.
    const whak = plan.trips.find((tr) => tr.destination.id === "a4.whakapanu")!;
    expect(whak.objectives.map((o) => o.id)).toEqual(expect.arrayContaining(["a4.map-whakapanu", "a4.great-white", "a4.diamora"]));
    const destinations = plan.trips.map((tr) => tr.destination.id);
    expect(new Set(destinations).size).toBe(destinations.length);
    expect(plan.notes.join(" ")).toMatch(/four Torn Maps/);
  });

  it("Act 4 island order follows where you are, not a fixed list", () => {
    const fromPrison = planRoute(g, deriveProgress(g, [zone("G4_town"), zone("G4_5_1")]), DEFAULT_SETTINGS);
    expect(fromPrison.trips[0]!.destination.id).toBe("a4.abandoned-prison");
    const fromKedge = planRoute(g, deriveProgress(g, [zone("G4_town"), zone("G4_2_1")]), DEFAULT_SETTINGS);
    expect(fromKedge.trips[0]!.destination.id).toBe("a4.kedge-bay");
  });

  it("Act 2: Desert Map stops after the Halani Gates, relics before the altar", () => {
    const p = deriveProgress(g, [zone("G2_town"), zone("G2_3")]);
    const ids = order(planRoute(g, p, DEFAULT_SETTINGS));
    expect(ids.indexOf("a2.sun-relic")).toBeLessThan(ids.indexOf("a2.jamanra"));
    expect(ids).toContain("a2.ancient-vows");
    expect(ids.at(-1)).toBe("a2.jamanra");
  });

  it("Interludes are planned together, finishing one before switching", () => {
    const p = deriveProgress(g, [zone("G4_town"), zone("P2_Town")]);
    const plan = planRoute(g, p, DEFAULT_SETTINGS);
    expect(plan.parts).toEqual(["int1", "int2", "int3"]);
    // Trips to areas with no known route (Skullmaw Stairway) come last and are ignored here.
    const parts = plan.trips.filter((tr) => !tr.steps[0]?.startsWith("Find")).map((tr) => tr.objectives[0]!.part);
    const switches = parts.filter((x, i) => i > 0 && x !== parts[i - 1]).length;
    expect(parts[0]).toBe("int2");
    expect(switches).toBe(2);
    expect(plan.notes.join(" ")).toMatch(/any order/);
  });

  it("Fast mode leaves low-value optional content out of the plan", () => {
    const p = deriveProgress(g, [zone("G1_town"), zone("G1_2")]);
    expect(order(planRoute(g, p, { ...DEFAULT_SETTINGS, mode: "fast" }))).not.toContain("a1.beira");
    expect(order(planRoute(g, p, DEFAULT_SETTINGS))).toContain("a1.beira");
  });

  it("scope follows the current zone", () => {
    expect(planScope(g, deriveProgress(g, [zone("G3_town")]))).toEqual(["act3"]);
    expect(planScope(g, deriveProgress(g, [zone("G4_town"), zone("P1_1")], done()))).toEqual(["int1", "int2", "int3"]);
  });
});

describe("build-aware hints", () => {
  const build = (stats: Record<string, number>, extra: Partial<CampaignBuildStats> = {}): CampaignBuildStats => ({ name: "b", className: "Monk", ascendClassName: "Invoker", level: 90, stats, ...extra });

  it("a weak resistance pushes its campaign reward up, with the reason", () => {
    const h = buildHints(g, build({ FireResist: 75, ColdResist: 75, LightningResist: 52 }), null);
    expect(h.boosts.get("a2.garukhan")?.reason).toMatch(/Lightning/);
    expect(h.boosts.has("a1.beira")).toBe(false);
    expect(h.lines.join(" ")).toMatch(/52%/);
    const p = deriveProgress(g, [zone("G2_town"), zone("G2_8")], done("a2.zalmarath"));
    const r = recommend(g, p, { settings: DEFAULT_SETTINGS, boosts: h.boosts });
    const all = [r.primary, ...r.alsoHere, ...r.secondary].find((x) => x?.objective.id === "a2.garukhan");
    expect(all?.reasons.join(" ")).toMatch(/Lightning resistance/);
  });

  it("Spirit-hungry builds prioritise Spirit rewards", () => {
    const h = buildHints(g, build({ Spirit: 250, SpiritUnreserved: 10 }), null);
    expect(h.boosts.get("a1.king-in-the-mists")?.bonus).toBe(25);
    expect(h.boosts.get("i3.lythara")).toBeDefined();
  });

  it("attribute shortfalls point at attribute choices; nothing is claimed without data", () => {
    const h = buildHints(g, build({ Int: 140, ReqInt: 157 }), null);
    expect(h.boosts.get("a4.tattoos")?.reason).toMatch(/Intelligence/);
    const empty = buildHints(g, build({}), null);
    expect(empty.boosts.size).toBe(0);
    expect(empty.lines[0]).toMatch(/Nothing/);
  });

  it("flags a build for another class", () => {
    expect(buildHints(g, build({}), "Stormweaver").lines.join(" ")).toMatch(/Invoker/);
  });
});
