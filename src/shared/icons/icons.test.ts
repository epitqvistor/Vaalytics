import { describe, expect, it } from "vitest";
import { ICONS } from "./icons";
import { cn } from "@/shared/utilities/cn";

describe("icon set", () => {
  it("every icon is a non-empty path that starts with a move command", () => {
    for (const [name, d] of Object.entries(ICONS)) {
      expect(d, name).toMatch(/^M/);
      // Coordinates must stay on the 20×20 grid.
      for (const n of d.match(/-?\d*\.?\d+/g) ?? []) {
        expect(Math.abs(Number(n)), `${name}: ${n}`).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe("cn", () => {
  it("joins truthy values and skips falsy ones", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
    expect(cn()).toBe("");
  });
});
