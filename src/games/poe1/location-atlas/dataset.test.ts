import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATLAS_META, loadAct, loadDataset } from "./data";
import type { ActData, AtlasDataset } from "./data/types";
import { validateAct, validateDataset } from "./data/validate";

const { dataset, issues } = await loadDataset();
const area = (id: string) => dataset.acts.flatMap((a) => a.areas).find((a) => a.id === id)!;

describe("PoE 1 campaign dataset (3.30)", () => {
  it("loads Acts 1–10 without errors", () => {
    expect(dataset.acts.map((a) => a.act)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(ATLAS_META.counts.areas).toBe(155);
  });

  it("keeps the game's facts: Lioneye's Watch, The Coast and its waypoint, Prison layouts", () => {
    expect(area("1_1_town")).toMatchObject({ name: "Lioneye's Watch", kind: "town", waypoint: true, connections: ["1_1_1", "1_1_2"] });
    expect(area("1_1_2")).toMatchObject({ name: "The Coast", waypoint: true, connections: ["1_1_2a", "1_1_3", "1_1_town"] });
    expect(area("1_1_7_1").topologies.length).toBeGreaterThan(1);
    expect(area("1_1_2a").bossNames).toEqual(["Hailrake"]);
  });

  it("every act has its town and every hint points at a known area", () => {
    for (const act of dataset.acts) expect(act.areas.some((a) => a.kind === "town")).toBe(true);
    const ids = new Set(dataset.acts.flatMap((a) => a.areas.map((x) => x.id)));
    for (const h of dataset.acts.flatMap((a) => a.hints)) expect(ids.has(h.area)).toBe(true);
  });

  it("community hints keep their direction and league-start flag", () => {
    const hailrake = dataset.acts[0]!.hints.filter((h) => h.area === "1_1_2a");
    expect(hailrake[0]).toMatchObject({ text: "Go left", direction: 270, leagueStartOnly: true });
  });

  it("names its sources with URL and licence", () => {
    expect(ATLAS_META.sources.map((s) => [s.id, s.license !== ""])).toEqual([
      ["repoe", true],
      ["exile-leveling", true],
    ]);
  });
});

describe("validation", () => {
  const clone = (): AtlasDataset => JSON.parse(JSON.stringify(dataset));

  it("rejects a malformed act instead of crashing", () => {
    expect(validateAct(null)[0]!.severity).toBe("error");
    expect(validateAct({ act: 1, areas: [{ id: "bad id" }], hints: [], quests: [] }).map((i) => i.message)).toContain("invalid area id");
  });

  it("finds duplicate ids, unknown connections and unknown hint areas", () => {
    const ds = clone();
    const a1 = ds.acts[0] as ActData;
    a1.areas.push({ ...a1.areas[0]! });
    a1.areas[1]!.connections.push("1_99_x");
    a1.hints.push({ area: "1_42_nowhere", step: "x", text: "y", leagueStartOnly: false });
    const msgs = validateDataset(ds).map((i) => i.message);
    expect(msgs).toContain("duplicate id");
    expect(msgs).toContain("connection to unknown area 1_99_x");
    expect(msgs).toContain("unknown area 1_42_nowhere");
  });

  it("a missing act file is reported, not thrown", async () => {
    const r = await loadAct(11);
    expect(r.act).toBeNull();
    expect(r.issues[0]!.message).toBe("no data file");
  });
});

// Real-log check (opt-in): VAALYTICS_POE1_LOG=<Client.txt> npx vitest run location-atlas
const LOG = process.env.VAALYTICS_POE1_LOG;
describe.skipIf(!LOG || !existsSync(LOG))("real PoE 1 Client.txt", () => {
  it("every campaign area in the log is in the dataset, with the logged area level", () => {
    const ids = new Map(dataset.acts.flatMap((a) => a.areas).map((a) => [a.id, a]));
    const seen = new Map<string, Set<number>>();
    for (const m of readFileSync(LOG!, "utf8").matchAll(/Generating level (\d+) area "([12]_\d+_[^"]+)"/g)) {
      if (m[2]!.startsWith("2_11")) continue; // endgame town
      seen.set(m[2]!, (seen.get(m[2]!) ?? new Set()).add(Number(m[1])));
    }
    const unknown = [...seen.keys()].filter((id) => !ids.has(id));
    const wrongLevel = [...seen].filter(([id, lv]) => ids.has(id) && !lv.has(ids.get(id)!.level));
    console.info(`log: ${seen.size} campaign areas seen, ${unknown.length} unknown, ${wrongLevel.length} with a different level`);
    expect(unknown).toEqual([]);
    expect(wrongLevel.map(([id, lv]) => `${id}: data ${ids.get(id)!.level}, log ${[...lv].join("/")}`)).toEqual([]);
  });
});
