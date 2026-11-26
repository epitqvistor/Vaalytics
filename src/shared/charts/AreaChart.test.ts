import { describe, expect, it } from "vitest";
import { xLabelIndices } from "./AreaChart";

describe("xLabelIndices", () => {
  it("always includes the first and last point", () => {
    const idx = xLabelIndices(30, 800);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(29);
  });

  it("fits the available width and never exceeds 8 labels", () => {
    expect(xLabelIndices(30, 200).length).toBe(3);
    expect(xLabelIndices(300, 4000).length).toBe(8);
  });

  it("never repeats an index for short series", () => {
    const idx = xLabelIndices(3, 1200);
    expect(idx).toEqual([0, 1, 2]);
    expect(xLabelIndices(1, 500)).toEqual([0]);
  });
});
