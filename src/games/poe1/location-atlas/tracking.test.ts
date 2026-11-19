import { describe, expect, it } from "vitest";
import type { CampaignEventRow } from "@/core/ipc/commands";
import { loadDataset } from "./data";
import { locate } from "./tracking";

const { dataset } = await loadDataset();
const areas = new Map(dataset.acts.flatMap((a) => a.areas).map((a) => [a.id, a]));
let t = 0;
const zone = (areaId: string, areaLevel: number | null = null): CampaignEventRow => ({ at: ++t, kind: "zone", areaId, areaName: null, areaLevel, amount: null, detail: null });
const level = (n: number): CampaignEventRow => ({ at: ++t, kind: "level", areaId: null, areaName: null, areaLevel: null, amount: n, detail: null });

describe("PoE 1 location from stored campaign events", () => {
  it("a character with no area yet is unknown", () => {
    expect(locate([level(2)], areas)).toMatchObject({ location: { kind: "unknown" }, level: 2, act: null });
  });

  it("follows the latest campaign area with its logged level", () => {
    const r = locate([zone("1_1_1", 1), zone("1_1_town", 13), zone("1_1_2", 2)], areas);
    expect(r.location).toMatchObject({ kind: "in-area", area: { id: "1_1_2", name: "The Coast" }, level: 2 });
    expect([...r.visited].sort()).toEqual(["1_1_1", "1_1_2", "1_1_town"]);
    expect(r.act).toBe(1);
  });

  it("outside the campaign keeps the last campaign area instead of guessing", () => {
    const r = locate([zone("2_6_town"), zone("HideoutCoastal"), zone("MapWorldsStrand")], areas);
    expect(r.location).toMatchObject({ kind: "outside", areaId: "MapWorldsStrand", last: { id: "2_6_town" } });
    expect(r.act).toBe(6);
  });

  it("reports campaign ids the dataset doesn't know (patch drift) and never maps them", () => {
    const r = locate([zone("1_1_2"), zone("1_1_99_new")], areas);
    expect(r.unknownAreas).toEqual(["1_1_99_new"]);
    expect(r.location.kind).toBe("outside");
  });

  it("the endgame town after Act 10 is not reported as drift", () => {
    expect(locate([zone("2_11_endgame_town")], areas).unknownAreas).toEqual([]);
  });
});
