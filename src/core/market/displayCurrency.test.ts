import { describe, expect, it } from "vitest";
import type { MarketItemRow } from "@/core/ipc/commands";
import { formatAmount } from "@/shared/utilities/format";
import { displayOptions } from "./DisplayCurrency";

const row = (itemId: string, name: string, value: number, variant: string | null = null): MarketItemRow => ({
  itemId,
  name,
  variant,
  icon: null,
  value,
  divineValue: null,
  change7d: null,
  sparkline: [],
  volumeValue: null,
  listings: null,
});
const chaos = { id: "chaos", short: "c", name: "Chaos Orb" };
const divine = { id: "divine", short: "div", name: "Divine Orb" };

describe("display currency", () => {
  it("lists base, premium, popular, then the rest; rates are base per unit", () => {
    const { options, rates } = displayOptions(
      [row("ancient", "Ancient Orb", 3), row("mirror", "Mirror of Kalandra", 46_927), row("divine", "Divine Orb", 155), row("exalted", "Exalted Orb", 0.79)],
      chaos,
      divine,
    );
    expect(options.map((o) => o.short)).toEqual(["c", "div", "ex", "mirror", "Ancient Orb"]);
    expect(rates.get("chaos")).toBe(1);
    expect(46_927 / rates.get("divine")!).toBeCloseTo(302.75, 2);
  });

  it("skips variants and zero prices; keeps premium listed before data loads", () => {
    const { options, rates } = displayOptions([row("x", "Odd", 0), row("y", "Map", 5, "T16")], chaos, divine);
    expect(options.map((o) => o.id)).toEqual(["chaos", "divine"]);
    expect(rates.has("divine")).toBe(false); // no rate → values stay in chaos
  });

  it("shows tiny converted amounts with significant digits", () => {
    expect(formatAmount(0.79 / 155)).toBe("0.0051");
    expect(formatAmount(0.25)).toBe("0.25");
  });
});
