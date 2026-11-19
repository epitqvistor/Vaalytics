import { describe, expect, it } from "vitest";
import { actRoot, buildActMap, NODE_H, NODE_W } from "./actMap";
import { loadDataset } from "./data";

const { dataset } = await loadDataset();
const areas = new Map(dataset.acts.flatMap((a) => a.areas).map((a) => [a.id, a]));

describe("act map (schematic)", () => {
  it("starts each act at its entrance from the previous act", () => {
    expect(areas.get(actRoot(1, areas)!)!.name).toBe("The Twilight Strand");
    expect(areas.get(actRoot(2, areas)!)!.name).toBe("The Southern Forest");
    expect(areas.get(actRoot(10, areas)!)!.name).toBe("Oriath Docks");
  });

  it("draws every area and every game connection of all ten acts, once", () => {
    for (const act of dataset.meta.acts) {
      const m = buildActMap(act, areas);
      const own = [...areas.values()].filter((a) => a.act === act);
      for (const a of own) expect(m.nodes.get(a.id)?.ghost, a.id).toBe(false);
      const drawn = new Set(m.edges.map((e) => [e.from, e.to].sort().join("|")));
      expect(drawn.size, `act ${act}`).toBe(m.edges.length);
      for (const a of own) for (const c of a.connections) expect(drawn.has([a.id, c].sort().join("|")), `${a.id}→${c}`).toBe(true);
    }
  });

  it("shows the neighbouring acts as ghosts with cross-act edges", () => {
    const m = buildActMap(1, areas);
    const ghosts = [...m.nodes.values()].filter((n) => n.ghost).map((n) => n.area.name).sort();
    expect(ghosts).toEqual(["The Southern Forest", "The Western Forest"]);
    expect(m.edges.filter((e) => e.crossAct).length).toBe(2);
  });

  it("nodes never overlap and stay inside the bounds", () => {
    for (const act of dataset.meta.acts) {
      const m = buildActMap(act, areas);
      const list = [...m.nodes.values()];
      for (const n of list) {
        expect(n.cx - NODE_W / 2).toBeGreaterThanOrEqual(0);
        expect(n.cy + NODE_H / 2).toBeLessThanOrEqual(m.bounds.height);
        expect(n.cx + NODE_W / 2).toBeLessThanOrEqual(m.bounds.width);
      }
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const apart = Math.abs(a.cx - b.cx) >= NODE_W || Math.abs(a.cy - b.cy) >= NODE_H;
          expect(apart, `${a.area.id} / ${b.area.id} in act ${act}`).toBe(true);
        }
    }
  });
});
