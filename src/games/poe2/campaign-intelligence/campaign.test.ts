import { describe, expect, it } from "vitest";
import { CAMPAIGN_0_5_5 } from "./data/0.5.5";
import type { CampaignDataset } from "./data/types";
import { validateDataset } from "./data/validate";
import { buildGraph, zoneFor } from "./engine/graph";
import { type CampaignEvent, deriveProgress } from "./engine/progress";
import { compatibility, patchFromClientTag } from "./engine/version";

const g = buildGraph(CAMPAIGN_0_5_5);
let t = 0;
const zone = (areaId: string, name?: string): CampaignEvent => ({ kind: "zone", at: ++t, areaId, name });
/** The two lines the real log writes for one book/turn-in. */
const points = (): CampaignEvent[] => [
  { kind: "passive-points", at: ++t, amount: 2, weaponSet: false },
  { kind: "passive-points", at: ++t, amount: 2, weaponSet: true },
];
const status = (p: ReturnType<typeof deriveProgress>, id: string) => p.objectives.get(id)!;

describe("0.5.5 dataset", () => {
  it("passes validation", () => {
    expect(validateDataset(CAMPAIGN_0_5_5)).toEqual([]);
  });

  it("matches the guaranteed totals published for 0.5.5f (24 passive points, 100 Spirit, 10% per resistance)", () => {
    const sum = (cat: string) => CAMPAIGN_0_5_5.rewards.filter((r) => r.category === cat).reduce((s, r) => s + (r.amount ?? 0), 0);
    expect(sum("passive")).toBe(24);
    expect(sum("spirit")).toBe(100);
    expect(sum("resistance")).toBe(30);
  });

  it("covers Acts 1–4 and the three Interludes, with no Cruel repeat", () => {
    expect(CAMPAIGN_0_5_5.parts.map((p) => p.id)).toEqual(["act1", "act2", "act3", "act4", "int1", "int2", "int3"]);
    expect(CAMPAIGN_0_5_5.zones.some((z) => /cruel/i.test(z.name))).toBe(false);
  });

  it("never marks a conflicting fact as confirmed", () => {
    for (const x of [...CAMPAIGN_0_5_5.objectives, ...CAMPAIGN_0_5_5.rewards]) {
      if (x.provenance.conflicts?.length) expect(x.provenance.verification, x.id).not.toBe("confirmed");
    }
  });

  it("detects broken references and cycles", () => {
    const broken: CampaignDataset = structuredClone(CAMPAIGN_0_5_5);
    broken.objectives[0]!.requires = ["a1.geonor"]; // miller ← geonor ← … ← miller
    broken.objectives[1]!.rewards = ["r.nope"];
    const problems = validateDataset(broken).map((i) => i.problem);
    expect(problems.some((p) => p.startsWith("dependency cycle"))).toBe(true);
    expect(problems).toContain("unknown reward r.nope");
  });
});

describe("zone lookup", () => {
  it("matches by area id, then by display name (trailing spaces in the log)", () => {
    expect(zoneFor(g, "G1_11")?.id).toBe("a1.hunting-grounds");
    expect(zoneFor(g, "G2_3a")?.id).toBe("a2.halani-gates");
    expect(zoneFor(g, "P2_4", "Skullmaw Stairway")?.id).toBe("i2.skullmaw");
    expect(zoneFor(g, "P2_3", "Sel Khari Sanctuary ")?.id).toBe("i2.sanctuary");
    expect(zoneFor(g, "MapRazedFields", "Razed Fields")).toBeNull();
  });
});

describe("progress engine", () => {
  it("a new character starts with only the first objective available", () => {
    const p = deriveProgress(g, [zone("G1_1")]);
    expect(status(p, "a1.miller").status).toBe("available");
    expect(status(p, "a1.geonor").status).toBe("locked");
    expect(p.currentZone).toBe("a1.riverbank");
    expect(p.partOpen.act2).toBe(false);
  });

  it("entering a zone never completes objectives inside it", () => {
    const p = deriveProgress(g, [zone("G1_1"), zone("G1_town"), zone("G1_2")]);
    expect(status(p, "a1.beira").status).toBe("available");
    // Clearfell opens after the Miller → inferred, not confirmed.
    expect(status(p, "a1.miller")).toMatchObject({ status: "done", confidence: "inferred" });
  });

  it("follows the current zone through towns, the hideout and a re-entry, with its logged area level", () => {
    const at = (areaId: string, level: number): CampaignEvent => ({ kind: "zone", at: ++t, areaId, level });
    let p = deriveProgress(g, [at("G1_1", 1), at("G1_town", 15)]);
    expect([p.currentZone, p.currentAreaLevel]).toEqual(["a1.town", 15]);
    p = deriveProgress(g, [at("G1_1", 1), at("G1_town", 15), at("HideoutFelled", 15)]);
    expect([p.currentZone, p.currentAreaLevel]).toEqual([null, null]);
    p = deriveProgress(g, [at("G1_1", 1), at("HideoutFelled", 15), at("G1_2", 2)]);
    expect([p.currentZone, p.currentAreaLevel]).toEqual(["a1.clearfell", 2]);
  });

  it("leaving a zone does not complete it", () => {
    const p = deriveProgress(g, [zone("G1_town"), zone("G1_12"), zone("G1_town")]);
    expect(status(p, "a1.king-in-the-mists").status).not.toBe("done");
  });

  it("attributes passive points to the objective claimed in that zone (real-log sequence)", () => {
    const ev = [zone("G1_1"), zone("G1_town"), zone("G1_7"), zone("G1_11"), ...points(), zone("G1_13_1"), zone("G1_town"), ...points()];
    const p = deriveProgress(g, ev);
    expect(status(p, "a1.crowbell")).toMatchObject({ status: "done", confidence: "inferred" });
    expect(status(p, "a1.una-lute")).toMatchObject({ status: "done", confidence: "inferred" });
    expect(p.unattributedGrants).toEqual([]);
  });

  it("killing a boss without a points line does not claim its reward", () => {
    // King in the Mists has no log signal: visiting Freythorn proves nothing.
    const p = deriveProgress(g, [zone("G1_11"), zone("G1_12"), zone("G1_11")]);
    expect(status(p, "a1.king-in-the-mists").status).toBe("available");
  });

  it("Kingsmarch grants: Dark Mists first, The Hooded One after the Interludes", () => {
    const act4 = [zone("G4_town"), zone("G4_2_1"), zone("G4_2_2"), zone("G4_town"), ...points()];
    const p1 = deriveProgress(g, act4);
    expect(status(p1, "a4.dark-mists").status).toBe("done");
    expect(status(p1, "a4.hooded-one").status).not.toBe("done");

    const all = [...act4, zone("P1_Town"), zone("P1_6"), zone("P2_Town"), zone("P2_7"), zone("P3_Town"), zone("P3_7"), zone("G4_town"), ...points()];
    const p2 = deriveProgress(g, all);
    expect(status(p2, "a4.hooded-one").status).toBe("done");
  });

  it("a skipped Dark Mists doesn't steal The Hooded One's grant", () => {
    const ev = [zone("G4_town"), zone("P1_6"), zone("P2_7"), zone("P3_7"), zone("G4_town"), ...points()];
    const p = deriveProgress(g, ev);
    expect(status(p, "a4.hooded-one").status).toBe("done");
    expect(status(p, "a4.dark-mists").status).toBe("available");
  });

  it("Act 4 islands open in any order once the player has sailed", () => {
    const p = deriveProgress(g, [zone("G4_town"), zone("G4_5_1")]);
    for (const id of ["a4.map-whakapanu", "a4.map-shrike", "a4.map-kin", "a4.map-kedge", "a4.eye-of-hinekora"]) {
      expect(status(p, id).status, id).toBe("available");
    }
    expect(status(p, "a4.plunders-point").status).toBe("locked");
  });

  it("Plunder's Point needs all four Torn Maps; entering it infers them", () => {
    const three = ["a4.map-whakapanu", "a4.map-shrike", "a4.map-kin"].map((objective) => ({ objective, mark: "done" as const, at: 1 }));
    expect(status(deriveProgress(g, [zone("G4_town")], three), "a4.plunders-point").status).toBe("locked");
    const p = deriveProgress(g, [zone("G4_town"), zone("G4_13")]);
    expect(status(p, "a4.map-kedge")).toMatchObject({ status: "done", confidence: "inferred" });
  });

  it("Interludes open together and can be done in any order", () => {
    const p = deriveProgress(g, [zone("G4_town"), zone("P3_Town")]);
    expect(p.partOpen).toMatchObject({ int1: true, int2: true, int3: true });
    expect(status(p, "a4.tavakai")).toMatchObject({ status: "done", confidence: "inferred" });
    expect(status(p, "i1.megaliths").status).toBe("available");
    expect(status(p, "i3.lythara").status).toBe("available");
  });

  it("Act 2 branches: Keth, Badlands and the Valley open together after the Halani Gates", () => {
    const p = deriveProgress(g, [zone("G2_town"), zone("G2_4_1")]);
    expect(status(p, "a2.halani").status).toBe("done");
    for (const id of ["a2.kabala", "a2.iktab", "a2.ancient-vows", "a2.sun-relic"]) expect(status(p, id).status, id).toBe("available");
  });

  it("ascension is attributed to the trial visited before the class change", () => {
    const p = deriveProgress(g, [zone("G3_town"), zone("G3_10_Airlock"), zone("G3_10"), { kind: "ascended", at: ++t, fromClass: "Monk", toClass: "Invoker" }]);
    expect(status(p, "a3.trial-of-chaos")).toMatchObject({ status: "done", confidence: "inferred" });
    expect(status(p, "a2.sekhemas").status).not.toBe("done");
  });

  it("manual marks: done, skipped, and reverting a wrong inference", () => {
    const ev = [zone("G1_11"), ...points()];
    const marks = [
      { objective: "a1.king-in-the-mists", mark: "done" as const, at: 1 },
      { objective: "a1.beira", mark: "skipped" as const, at: 1 },
      { objective: "a1.crowbell", mark: "not-done" as const, at: 2 },
    ];
    const p = deriveProgress(g, ev, marks);
    expect(status(p, "a1.king-in-the-mists")).toMatchObject({ status: "done", confidence: "manual" });
    expect(status(p, "a1.beira").status).toBe("skipped");
    expect(status(p, "a1.crowbell").status).not.toBe("done");
  });

  it("the latest manual mark wins", () => {
    const marks = [
      { objective: "a1.beira", mark: "skipped" as const, at: 1 },
      { objective: "a1.beira", mark: "done" as const, at: 5 },
    ];
    expect(status(deriveProgress(g, [zone("G1_2")], marks), "a1.beira").confidence).toBe("manual");
  });

  it("duplicate events don't double-credit or double-count", () => {
    const ev = [zone("G1_11"), zone("G1_11"), ...points(), ...points()];
    const p = deriveProgress(g, ev);
    expect(status(p, "a1.crowbell").status).toBe("done");
    // The second grant in the same zone has no other candidate.
    expect(p.unattributedGrants).toHaveLength(1);
  });

  it("unknown campaign areas are reported, not guessed", () => {
    const p = deriveProgress(g, [zone("G1_10", "Some New Zone"), zone("MapRazedFields")]);
    expect(p.unknownAreas).toEqual(["G1_10"]);
    expect(p.currentZone).toBeNull();
  });

  it("a missing prerequisite keeps an objective locked", () => {
    const p = deriveProgress(g, [zone("G3_town")]);
    expect(status(p, "a3.aggorat-altar").status).toBe("locked");
  });
});

describe("dataset version", () => {
  it("reads the client tag and flags a mismatch", () => {
    expect(patchFromClientTag("0.5.5g")).toBe("0.5.5");
    expect(patchFromClientTag("4.5.4f")).toBeNull();
    expect(compatibility("0.5.5", "0.5.5g").kind).toBe("match");
    expect(compatibility("0.5.5", "0.6.0").kind).toBe("different");
    expect(compatibility("0.5.5", "4.5.4f").kind).toBe("unknown");
  });
});

describe("Rust event rows → engine events", () => {
  it("maps every stored kind and keeps unknown names", async () => {
    const { toEngineEvents } = await import("./engine/events");
    const ev = toEngineEvents([
      { at: 1, kind: "zone", areaId: "G1_11", areaName: "Hunting Grounds", areaLevel: 10, amount: null, detail: null },
      { at: 2, kind: "passive_points", areaId: null, areaName: null, areaLevel: null, amount: 2, detail: null },
      { at: 2, kind: "weapon_set_points", areaId: null, areaName: null, areaLevel: null, amount: 2, detail: null },
      { at: 3, kind: "level", areaId: null, areaName: null, areaLevel: null, amount: 11, detail: null },
      { at: 4, kind: "ascended", areaId: null, areaName: null, areaLevel: null, amount: null, detail: "Monk→Invoker" },
      { at: 5, kind: "death", areaId: null, areaName: null, areaLevel: null, amount: null, detail: null },
    ]);
    expect(ev.map((e) => e.kind)).toEqual(["zone", "passive-points", "passive-points", "level", "ascended", "death"]);
    expect(ev[4]).toMatchObject({ fromClass: "Monk", toClass: "Invoker" });
    const p = deriveProgress(g, ev);
    expect(p.objectives.get("a1.crowbell")?.status).toBe("done");
    expect(p.level).toBe(11);
    expect(p.deaths).toBe(1);
  });
});
