import { describe, expect, it } from "vitest";
import { loadDataset } from "./data";
import { browseAreas, DEFAULT_PREFS, isAtlasPrefs, pushRecent, RECENT_MAX, type BrowseContext } from "./browser";

const { dataset } = await loadDataset();
const areas = dataset.acts.flatMap((a) => a.areas);
const hintCount = new Map<string, number>();
for (const h of dataset.acts.flatMap((a) => a.hints)) hintCount.set(h.area, (hintCount.get(h.area) ?? 0) + 1);
const ctx = (p: Partial<BrowseContext>): BrowseContext => ({ act: 1, query: "", filter: "all", favorites: [], recent: [], visited: new Set(), hintCount, ...p });
const names = (l: { name: string }[]) => l.map((a) => a.name);

describe("location browser", () => {
  it("lists the chosen act from the dataset", () => {
    const act1 = browseAreas(areas, ctx({}));
    expect(act1.every((a) => a.act === 1)).toBe(true);
    expect(names(act1)).toContain("The Coast");
    expect(browseAreas(areas, ctx({ act: 10 })).every((a) => a.act === 10)).toBe(true);
  });

  it("searches by name across all acts", () => {
    const r = names(browseAreas(areas, ctx({ query: "coast" })));
    expect(r).toContain("The Coast");
    expect(new Set(browseAreas(areas, ctx({ query: "coast" })).map((a) => a.act)).size).toBeGreaterThan(1);
    expect(browseAreas(areas, ctx({ query: "zzzz" }))).toEqual([]);
  });

  it("filters towns, waypoints, bosses, hints and visited within the act", () => {
    expect(names(browseAreas(areas, ctx({ filter: "towns" })))).toEqual(["Lioneye's Watch"]);
    expect(browseAreas(areas, ctx({ filter: "waypoints" })).every((a) => a.waypoint)).toBe(true);
    expect(names(browseAreas(areas, ctx({ filter: "bosses" })))).toContain("The Tidal Island");
    expect(browseAreas(areas, ctx({ filter: "hints" })).every((a) => (hintCount.get(a.id) ?? 0) > 0)).toBe(true);
    expect(names(browseAreas(areas, ctx({ filter: "visited", visited: new Set(["1_1_2"]) })))).toEqual(["The Coast"]);
  });

  it("favourites span all acts; recent keeps visit order", () => {
    expect(browseAreas(areas, ctx({ filter: "favorites", favorites: ["2_6_town", "1_1_2"] })).map((a) => a.id).sort()).toEqual(["1_1_2", "2_6_town"]);
    expect(browseAreas(areas, ctx({ filter: "recent", recent: ["2_6_town", "1_1_2"] })).map((a) => a.id)).toEqual(["2_6_town", "1_1_2"]);
  });

  it("recent list moves an area to the front and is capped", () => {
    let r: string[] = [];
    for (let i = 0; i < 20; i++) r = pushRecent(r, i % 2 ? "1_1_2" : `1_1_${i}`);
    expect(r[0]).toBe("1_1_2");
    expect(r.length).toBeLessThanOrEqual(RECENT_MAX);
    expect(new Set(r).size).toBe(r.length);
  });

  it("stored preferences are validated", () => {
    expect(isAtlasPrefs(DEFAULT_PREFS)).toBe(true);
    expect(isAtlasPrefs({ ...DEFAULT_PREFS, act: 11 })).toBe(false);
    expect(isAtlasPrefs({ ...DEFAULT_PREFS, favorites: ["<script>"] })).toBe(false);
    expect(isAtlasPrefs({ ...DEFAULT_PREFS, filter: "nope" })).toBe(false);
  });
});
