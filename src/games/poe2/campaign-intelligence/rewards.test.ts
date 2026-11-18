import { describe, expect, it } from "vitest";
import type { CampaignRewardMark } from "@/core/ipc/commands";
import { CAMPAIGN_0_5_5 } from "./data/0.5.5";
import { buildGraph } from "./engine/graph";
import { type CampaignEvent, type ManualMark, deriveProgress } from "./engine/progress";
import { missedObjectives, recoveryRoute } from "./engine/recovery";
import { heldItemWarnings, rewardStatuses, rewardTotals } from "./engine/rewards";

const g = buildGraph(CAMPAIGN_0_5_5);
let t = 0;
const zone = (areaId: string): CampaignEvent => ({ kind: "zone", at: ++t, areaId });
const grant = (): CampaignEvent[] => [
  { kind: "passive-points", at: ++t, amount: 2, weaponSet: false },
  { kind: "passive-points", at: ++t, amount: 2, weaponSet: true },
];
const mark = (objective: string, m: ManualMark["mark"], choice?: string): ManualMark => ({ objective, mark: m, at: ++t, choice });
const rmark = (rewardId: string, stage: CampaignRewardMark["stage"], choice: string | null = null): CampaignRewardMark => ({ rewardId, stage, choice, at: ++t });
const byId = (s: ReturnType<typeof rewardStatuses>, id: string) => s.find((x) => x.reward.id === id)!;

describe("Reward Guardian", () => {
  it("separates applied (logged), confirmed (by you), uncertain, skipped and locked", () => {
    const p = deriveProgress(g, [zone("G1_town"), zone("G1_7"), zone("G1_11"), ...grant()], [mark("a1.king-in-the-mists", "done"), mark("a1.beira", "skipped")]);
    const s = rewardStatuses(g, p);
    expect(byId(s, "r.a1.crowbell")).toMatchObject({ state: "applied", bucket: "earned", confidence: "inferred" });
    expect(byId(s, "r.a1.king")).toMatchObject({ state: "complete", bucket: "earned", confidence: "manual" });
    expect(byId(s, "r.a1.beira")).toMatchObject({ state: "skipped", bucket: "missing" });
    expect(byId(s, "r.a1.una")).toMatchObject({ state: "available", bucket: "missing" });
    expect(byId(s, "r.a2.kabala")).toMatchObject({ state: "not-available", bucket: "locked" });
  });

  it("a boss defeated is not a reward claimed (regression)", () => {
    const p = deriveProgress(g, [zone("G1_town"), zone("G1_7"), zone("G1_11"), zone("G1_12")]);
    const s = rewardStatuses(g, p, [rmark("r.a1.king", "boss-defeated")]);
    expect(byId(s, "r.a1.king")).toMatchObject({ state: "boss-defeated", bucket: "pending" });
    expect(heldItemWarnings(g, s)[0]).toMatch(/isn't claimed yet/);
  });

  it("an item in hand but not handed in is warned about", () => {
    const p = deriveProgress(g, [zone("G1_town"), zone("G1_7"), zone("G1_13_1")]);
    const s = rewardStatuses(g, p, [rmark("r.a1.una", "item-acquired")]);
    expect(byId(s, "r.a1.una").state).toBe("item-acquired");
    expect(heldItemWarnings(g, s)[0]).toMatch(/Clearfell Encampment/);
  });

  it("an objective inferred only from a later zone leaves its reward uncertain", () => {
    const p = deriveProgress(g, [zone("G1_town")]);
    p.objectives.set("a1.candlemass", { id: "a1.candlemass", status: "done", confidence: "inferred", source: "zone-gate", evidence: "test", at: 1 });
    expect(byId(rewardStatuses(g, p), "r.a1.candlemass")).toMatchObject({ state: "uncertain", bucket: "uncertain" });
  });

  it("stores the chosen option of a choice reward and never assumes the others", () => {
    const p = deriveProgress(g, [zone("G3_town")], [mark("a3.servi-draught", "done", "25% increased Mana Regeneration Rate")]);
    const s = byId(rewardStatuses(g, p), "r.a3.servi");
    expect(s.choice).toBe("25% increased Mana Regeneration Rate");
    const viaReward = byId(rewardStatuses(g, p, [rmark("r.a3.servi", "complete", "30% increased Elemental Ailment Threshold")]), "r.a3.servi");
    expect(viaReward.choice).toBe("30% increased Elemental Ailment Threshold");
  });

  it("totals per track add up to the published campaign totals", () => {
    const totals = rewardTotals(rewardStatuses(g, deriveProgress(g, [zone("G1_1")])));
    const of = (k: string) => totals.find((x) => x.track === k)!;
    expect(of("passive").total).toBe(24);
    expect(of("spirit").total).toBe(100);
    expect([of("res-cold").total, of("res-fire").total, of("res-lightning").total]).toEqual([10, 10, 10]);
    expect(of("life-flat").total).toBe(20);
    expect(of("ascendancy").total).toBe(4);
    const after = rewardTotals(rewardStatuses(g, deriveProgress(g, [zone("G1_town"), zone("G1_7"), zone("G1_11"), ...grant()])));
    expect(after.find((x) => x.track === "passive")).toMatchObject({ earned: 2, missing: 2, locked: 20 });
  });
});

describe("Missed objectives recovery", () => {
  it("lists rewards left behind in a finished act, passive points and Spirit first", () => {
    const p = deriveProgress(g, [zone("G1_town"), zone("G1_7"), zone("G1_11"), zone("G2_town")]);
    const m = missedObjectives(g, p);
    const ids = m.map((x) => x.objective.id);
    expect(ids).toEqual(expect.arrayContaining(["a1.crowbell", "a1.king-in-the-mists", "a1.una-lute", "a1.beira", "a1.candlemass"]));
    expect(m[0]!.rewards.some((r) => r.category === "passive" || r.category === "spirit")).toBe(true);
    expect(m.every((x) => x.reason === "act-finished")).toBe(true);
    expect(ids).not.toContain("a1.geonor"); // no reward, main quest
  });

  it("notices an area left behind without a confirmation", () => {
    const p = deriveProgress(g, [zone("G1_town"), zone("G1_2"), zone("G1_4"), zone("G1_7"), zone("G1_11")]);
    const beira = missedObjectives(g, p).find((x) => x.objective.id === "a1.beira");
    expect(beira?.reason).toBe("left-behind");
  });

  it("skipped objectives are remembered and explained with their prerequisites", () => {
    const p = deriveProgress(g, [zone("G1_town")], [mark("a1.candlemass", "skipped")]);
    const c = missedObjectives(g, p).find((x) => x.objective.id === "a1.candlemass")!;
    expect(c.reason).toBe("skipped");
    expect(c.missingPrerequisites.map((x) => x.id)).toEqual(["a1.village-executioner"]);
    expect(c.advice).toBe("later");
    expect(recoveryRoute(g, p, [c])).toEqual([]);
  });

  it("confirmed objectives are never listed as missed", () => {
    const p = deriveProgress(g, [zone("G1_town"), zone("G1_7"), zone("G1_11"), ...grant(), zone("G2_town")], [mark("a1.king-in-the-mists", "done")]);
    const ids = missedObjectives(g, p).map((x) => x.objective.id);
    expect(ids).not.toContain("a1.crowbell");
    expect(ids).not.toContain("a1.king-in-the-mists");
  });

  it("builds one return trip that groups objectives by zone, nearest first", () => {
    const p = deriveProgress(g, [zone("G1_town"), zone("G1_2"), zone("G1_7"), zone("G1_11"), zone("G1_12"), zone("G1_13_1"), zone("G2_town")]);
    const stops = recoveryRoute(g, p, missedObjectives(g, p));
    const zones = stops.map((s) => s.zone.id);
    expect(new Set(zones).size).toBe(zones.length);
    expect(zones).toEqual(expect.arrayContaining(["a1.hunting-grounds", "a1.freythorn", "a1.clearfell"]));
    // Hunting Grounds and Freythorn are next to each other: consecutive stops.
    expect(Math.abs(zones.indexOf("a1.hunting-grounds") - zones.indexOf("a1.freythorn"))).toBe(1);
    expect(stops.every((s) => s.steps.length > 0)).toBe(true);
  });
});
