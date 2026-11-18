import { describe, expect, it } from "vitest";
import { CAMPAIGN_0_5_5 } from "./data/0.5.5";
import { buildGraph } from "./engine/graph";
import { type CampaignEvent, type ManualMark, deriveProgress } from "./engine/progress";
import { DEFAULT_SETTINGS, type ModeSettings, recommend } from "./engine/recommend";
import { travelFrom } from "./engine/travel";

const g = buildGraph(CAMPAIGN_0_5_5);
let t = 0;
const zone = (areaId: string): CampaignEvent => ({ kind: "zone", at: ++t, areaId });
const level = (n: number): CampaignEvent => ({ kind: "level", at: ++t, level: n });
const done = (...ids: string[]): ManualMark[] => ids.map((objective) => ({ objective, mark: "done", at: 1 }));
const run = (events: CampaignEvent[], marks: ManualMark[] = [], settings: Partial<ModeSettings> = {}, previous: string | null = null) =>
  recommend(g, deriveProgress(g, events, marks), { settings: { ...DEFAULT_SETTINGS, ...settings }, previous });

describe("navigator", () => {
  it("a new character is told to defeat The Bloated Miller, right where they are", () => {
    const r = run([zone("G1_1")]);
    expect(r.primary?.objective.id).toBe("a1.miller");
    expect(r.primary?.travel).toEqual([]);
    expect(r.primary?.importance).toBe("critical");
    expect(r.primary?.objective.steps.length).toBeGreaterThan(1);
  });

  it("prefers the permanent reward where you stand over walking away", () => {
    const r = run([zone("G1_town"), zone("G1_7"), zone("G1_11")]);
    expect(r.primary?.objective.id).toBe("a1.crowbell");
    expect(r.primary?.detection.kind).toBe("automatic");
    expect(r.secondary.map((s) => s.objective.id)).toContain("a1.king-in-the-mists");
  });

  it("Fast mode skips low-value optional bosses but keeps passive points", () => {
    const atClearfell = run([zone("G1_town"), zone("G1_2")], [], { mode: "fast" });
    const ids = [atClearfell.primary, ...atClearfell.alsoHere, ...atClearfell.secondary].map((x) => x?.objective.id);
    expect(ids).not.toContain("a1.beira");
    expect(run([zone("G1_town"), zone("G1_7"), zone("G1_11")], [], { mode: "fast" }).primary?.objective.id).toBe("a1.crowbell");
  });

  it("never recommends a locked objective (Plunder's Point without four maps)", () => {
    const r = run([zone("G4_town")], done("a4.map-whakapanu", "a4.map-shrike", "a4.map-kin"));
    const all = [r.primary, ...r.alsoHere, ...r.secondary].map((x) => x?.objective.id);
    expect(all).not.toContain("a4.plunders-point");
  });

  it("Act 4: groups the objectives of one island into one trip", () => {
    const r = run([zone("G4_town"), zone("G4_3_1")]);
    const here = [r.primary, ...r.alsoHere].map((x) => x?.objective.id);
    expect(here).toEqual(expect.arrayContaining(["a4.map-whakapanu", "a4.great-white"]));
    expect(r.explanation).toMatch(/same trip/);
  });

  it("travel steps use the hub for islands and walking for connected zones", () => {
    const p = deriveProgress(g, [zone("G4_town")]);
    const routes = travelFrom(g, "a4.town", p.visited, new Set(["act4"]));
    expect(routes.planTo("a4.singing-caverns")?.steps.map((s) => s.via)).toEqual(["hub", "walk"]);
  });

  it("Custom mode only chases the chosen categories", () => {
    const r = run([zone("G1_town"), zone("G1_2")], [], { mode: "custom", categories: ["spirit"] });
    const ids = [r.primary, ...r.alsoHere, ...r.secondary].map((x) => x?.objective.id);
    expect(ids).not.toContain("a1.beira");
  });

  it("pinned objectives come first and missing quest items are warned about", () => {
    const r = run([zone("G2_town"), zone("G2_6")], [], { pinned: ["a2.ancient-vows"] });
    expect(r.primary?.objective.id).toBe("a2.ancient-vows");
    expect(r.primary?.missingItems.map((m) => m.name)).toEqual(["Sun Clan Relic", "Kabala Clan Relic"]);
    expect(r.warnings.some((w) => w.kind === "items")).toBe(true);
  });

  it("is stable: keeps the previous objective while it's still close, explains a change", () => {
    const ev = [zone("G1_town"), zone("G1_7"), zone("G1_11")];
    const marks = done("a1.crowbell");
    const best = run(ev, marks).primary!.objective.id;
    const other = best === "a1.una-lute" ? "a1.king-in-the-mists" : "a1.una-lute";
    const kept = run(ev, marks, {}, other);
    expect(kept.primary?.objective.id).toBe(other);
    expect(kept.changed).toBeNull();
    const after = run(ev, [...marks, ...done(other)], {}, other);
    expect(after.primary?.objective.id).not.toBe(other);
    expect(after.changed?.reason).toMatch(/is done/);
  });

  it("a clearly better option replaces the previous one, with the reason", () => {
    // Previous pick was Freythorn; standing at the Crowbell makes the Crowbell clearly better.
    const r = run([zone("G1_town"), zone("G1_7"), zone("G1_11")], [], {}, "a1.una-lute");
    expect(r.primary?.objective.id).toBe("a1.crowbell");
    expect(r.changed?.reason).toMatch(/clearly better/);
  });

  it("explains a level gap without telling the player to grind", () => {
    const r = run([zone("G1_town"), level(2), zone("G1_15")], done("a1.village-executioner", "a1.candlemass"));
    expect(r.primary?.objective.id).toBe("a1.geonor");
    expect(r.warnings.find((w) => w.kind === "level")?.text).toMatch(/level 2/);
    expect(r.warnings.find((w) => w.kind === "level")?.text).not.toMatch(/grind/i);
  });

  it("Interludes: any order, then The Hooded One", () => {
    const after4 = run([zone("G4_town"), zone("P1_Town")]);
    expect(after4.primary?.objective.part).toBe("int1");
    const finishedTwo = run([zone("G4_town"), zone("P1_Town")], done("i1.wulfric", "i2.azmadi"));
    const parts = [finishedTwo.primary, ...finishedTwo.secondary].map((x) => x?.objective.part);
    expect(parts).toContain("int3");
    const allDone = run([zone("G4_town")], done("i1.wulfric", "i2.azmadi", "i3.zolin-zelina"));
    const ids = [allDone.primary, ...allDone.alsoHere, ...allDone.secondary].map((x) => x?.objective.id);
    expect(ids).toContain("a4.hooded-one");
  });

  it("reports completion when nothing is left", () => {
    const marks = done(...CAMPAIGN_0_5_5.objectives.map((o) => o.id));
    const r = run([zone("G4_town")], marks);
    expect(r.complete).toBe(true);
    expect(r.primary).toBeNull();
  });

  it("Power Leveling favours nearby optional content when under-levelled", () => {
    const ev = [zone("G1_town"), zone("G1_7"), level(5), { kind: "zone", at: ++t, areaId: "G1_11", level: 10 } as CampaignEvent];
    const r = run(ev, [], { mode: "power" });
    expect(r.primary?.reasons.join(" ")).toMatch(/under-levelled/);
  });
});
