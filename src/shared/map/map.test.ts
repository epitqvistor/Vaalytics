import { describe, expect, it } from "vitest";
import { layeredLayout } from "./layered";
import { fitView, MAX_ZOOM, MIN_ZOOM, panBy, toContent, zoomAt } from "./viewport";

describe("layered layout", () => {
  const chain = layeredLayout({ nodes: ["a", "b", "c", "d"], links: [["a", "b"], ["b", "c"], ["b", "d"]], root: "a" });

  it("puts nodes in columns by walking distance from the root", () => {
    expect([...chain.nodes.values()].map((n) => [n.id, n.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 2],
    ]);
    expect(chain.columns).toBe(3);
    expect(chain.rows).toBe(2);
  });

  it("uses normalised, non-overlapping positions", () => {
    const pos = [...chain.nodes.values()].map((n) => `${n.x},${n.y}`);
    expect(new Set(pos).size).toBe(pos.length);
    for (const n of chain.nodes.values()) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic and survives unknown links, self-links and disconnected nodes", () => {
    const input = { nodes: ["a", "b", "x"], links: [["a", "b"], ["a", "a"], ["a", "zz"]] as [string, string][], root: "a" };
    const one = layeredLayout(input);
    expect(JSON.stringify([...one.nodes])).toBe(JSON.stringify([...layeredLayout(input).nodes]));
    expect(one.nodes.get("x")!.depth).toBe(2);
    expect(layeredLayout({ nodes: [], links: [], root: "a" }).nodes.size).toBe(0);
  });

  it("orders a column by its neighbours to avoid crossings", () => {
    // a—c and b—d: the second column must keep c above d.
    const l = layeredLayout({ nodes: ["r", "a", "b", "d", "c"], links: [["r", "a"], ["r", "b"], ["a", "c"], ["b", "d"]], root: "r" });
    expect(l.nodes.get("c")!.row).toBeLessThan(l.nodes.get("d")!.row);
  });
});

describe("viewport", () => {
  it("zooms around the cursor and clamps the zoom", () => {
    const v = zoomAt({ x: 0, y: 0, k: 1 }, 2, { x: 100, y: 50 });
    expect(toContent(v, { x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
    expect(zoomAt(v, 100, { x: 0, y: 0 }).k).toBe(MAX_ZOOM);
    expect(zoomAt(v, 0.001, { x: 0, y: 0 }).k).toBe(MIN_ZOOM);
  });

  it("pans and fits content into the viewport", () => {
    expect(panBy({ x: 1, y: 2, k: 1 }, 10, -2)).toEqual({ x: 11, y: 0, k: 1 });
    const f = fitView({ x: 0, y: 0, width: 400, height: 200 }, 848, 448, 24);
    expect(f.k).toBeCloseTo(1.5); // capped: never blown up past 1.5×
    const centre = toContent(f, { x: 424, y: 224 });
    expect(centre.x).toBeCloseTo(200);
    expect(centre.y).toBeCloseTo(100);
    expect(fitView({ x: 0, y: 0, width: 0, height: 0 }, 100, 100)).toEqual({ x: 0, y: 0, k: 1 });
  });
});
