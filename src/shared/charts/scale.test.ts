import { describe, expect, it } from "vitest";
import { areaPath, nearestIndex, niceTicks, paddedExtent, toPoints } from "./scale";

describe("chart scale", () => {
  it("pads the extent and handles flat series", () => {
    expect(paddedExtent([0, 10], 0.1)).toEqual({ min: -1, max: 11 });
    const flat = paddedExtent([5, 5, 5]);
    expect(flat.max).toBeGreaterThan(flat.min);
    expect(paddedExtent([])).toEqual({ min: 0, max: 1 });
  });

  it("maps first/last points to the edges, higher values upward", () => {
    const pts = toPoints([0, 10], 100, 50, { min: 0, max: 10 });
    expect(pts).toEqual([
      [0, 50],
      [100, 0],
    ]);
  });

  it("closes the area to the baseline", () => {
    expect(areaPath([[0, 10], [100, 0]], 50)).toBe("M0.0 10.0L100.0 0.0L100.0 50L0.0 50Z");
  });

  it("produces round ticks inside the extent", () => {
    expect(niceTicks({ min: 0, max: 100 }, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks({ min: 151.3, max: 198.7 }, 4)).toEqual([160, 170, 180, 190]);
  });

  it("snaps x to the nearest index", () => {
    expect(nearestIndex(0, 100, 5)).toBe(0);
    expect(nearestIndex(49, 100, 5)).toBe(2);
    expect(nearestIndex(500, 100, 5)).toBe(4);
  });
});
