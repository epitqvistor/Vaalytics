import { describe, expect, it } from "vitest";
import { CAMPAIGN_0_5_5 } from "./data/0.5.5";
import { buildGraph } from "./engine/graph";
import { BREAK_GAP_S, campaignTimeline, formatDuration, personalBests, runStats } from "./engine/history";
import { type CampaignEvent, deriveProgress } from "./engine/progress";

const g = buildGraph(CAMPAIGN_0_5_5);
const zone = (at: number, areaId: string): CampaignEvent => ({ kind: "zone", at, areaId });
const part = (s: ReturnType<typeof runStats>, id: string) => s.parts.find((p) => p.part === id)!;

describe("Run history", () => {
  const events: CampaignEvent[] = [
    { kind: "level", at: 0, level: 1 },
    zone(10, "G1_1"),
    zone(70, "G1_town"),
    { kind: "death", at: 100 },
    { kind: "level", at: 110, level: 5 },
    zone(130, "G1_1"),
    // Client closed for hours: not counted.
    zone(130 + BREAK_GAP_S + 1, "G1_town"),
    { kind: "level", at: 1500 + BREAK_GAP_S, level: 15 },
    zone(1510 + BREAK_GAP_S, "G2_1"), // Act 2 opens only after Geonor → Act 1 finished here
    zone(1570 + BREAK_GAP_S, "HideoutFelled"), // left the campaign
    zone(9000 + BREAK_GAP_S, "G2_town"),
  ];
  const p = deriveProgress(g, events);
  const s = runStats(g, events, p);

  it("adds up active time per part, skipping breaks and time outside the campaign", () => {
    // Act 1: 10→70, 70→100, 100→110, 110→130, then a break, then town → level-up → G2_1.
    expect(part(s, "act1").activeSeconds).toBe(60 + 30 + 10 + 20 + (1500 - 131) + 10);
    expect(part(s, "act2").activeSeconds).toBe(60);
    expect(s.breaks).toBe(1);
    expect(s.deaths).toBe(1);
    expect(part(s, "act1").deaths).toBe(1);
  });

  it("finishes an act when the next act's gate is credited, with levels in and out", () => {
    expect(part(s, "act1")).toMatchObject({ finished: true, timed: true, finishedAt: 1510 + BREAK_GAP_S, levelIn: 1, levelOut: 15 });
    expect(part(s, "act2").finished).toBe(false);
    expect(s.campaignSeconds).toBeNull();
  });

  it("Act 4 ends where the Interludes open (regression: it never finished on real logs)", () => {
    const ev = [zone(0, "G4_town"), zone(500, "P1_Town")];
    const s4 = runStats(g, ev, deriveProgress(g, ev));
    expect(part(s4, "act4")).toMatchObject({ finished: true, finishedAt: 500, activeSeconds: 500 });
    // Interludes are not Acts: they don't borrow Act 1's (empty) gate.
    expect(part(s4, "int1").finished).toBe(false);
  });

  it("a run whose log starts mid-campaign is not timed (no fake personal bests)", () => {
    // History starts in Act 2 at level 62 (real case): Act 2 finishes, but Act 1 was never seen.
    const ev: CampaignEvent[] = [{ kind: "level", at: 0, level: 62 }, zone(0, "G2_1"), zone(660, "G3_town")];
    const sm = runStats(g, ev, deriveProgress(g, ev));
    expect(part(sm, "act2")).toMatchObject({ finished: true, timed: false });
    // Act 1 without the first level-ups isn't timed either.
    const ev1: CampaignEvent[] = [{ kind: "level", at: 0, level: 5 }, zone(0, "G1_1"), zone(100, "G2_1")];
    expect(part(runStats(g, ev1, deriveProgress(g, ev1)), "act1").timed).toBe(false);
    expect(personalBests([{ characterId: 1, name: "A", stats: sm }]).parts.size).toBe(0);
  });

  it("separates town time and backtracking; a town portal trip is not backtracking", () => {
    const ev = [
      zone(0, "G1_1"), // Riverbank
      zone(100, "G1_town"),
      zone(150, "G1_1"), // portal back: not backtracking
      zone(200, "G1_2"), // moved on
      zone(300, "G1_1"), // back to Riverbank: backtracking
      zone(340, "G1_2"),
      zone(400, "G1_town"),
    ];
    const sb = runStats(g, ev, deriveProgress(g, ev));
    expect(sb.townSeconds).toBe(50);
    expect(sb.revisitSeconds).toBe(40 + 60); // Riverbank again, then Clearfell again (left it for Riverbank)
    expect(sb.activeSeconds).toBe(400);
  });

  it("counts zone visits and deaths per zone", () => {
    expect(s.zones.get("a1.riverbank")).toMatchObject({ visits: 2, deaths: 0 });
    expect(s.zones.get("a1.town")).toMatchObject({ visits: 2, deaths: 1 });
  });

  it("a manual finish has no time (the click isn't the play time)", () => {
    const pm = deriveProgress(g, [zone(10, "G1_1")], [{ objective: "a1.geonor", mark: "done", at: 99999 }]);
    expect(part(runStats(g, [zone(10, "G1_1")], pm), "act1")).toMatchObject({ finished: true, finishedAt: null });
  });

  it("builds a timeline in order with part entries, deaths, 5th levels and credited objectives", () => {
    const t = campaignTimeline(g, events, p);
    expect(t.map((x) => x.kind)).toEqual(["part", "death", "level", "level", "objective", "part"]);
    expect(t.find((x) => x.kind === "death")!.text).toBe("Died in Clearfell Encampment");
    expect(t.filter((x) => x.kind === "objective").every((x) => x.at === 1510 + BREAK_GAP_S)).toBe(true);
    expect(t.at(-1)!.kind).toBe("part");
  });

  it("personal bests take the fastest finished part across runs", () => {
    const slow = { characterId: 1, name: "A", stats: s };
    const fastEvents: CampaignEvent[] = [{ kind: "level", at: 0, level: 2 }, zone(0, "G1_1"), zone(100, "G2_1")];
    const fast = { characterId: 2, name: "B", stats: runStats(g, fastEvents, deriveProgress(g, fastEvents)) };
    const pb = personalBests([slow, fast]);
    expect(pb.parts.get("act1")).toBe(100);
    expect(pb.parts.has("act2")).toBe(false);
    expect(pb.campaign).toBeNull();
  });

  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(12 * 60)).toBe("12 min");
    expect(formatDuration(3900)).toBe("1 h 05 min");
  });
});
