import { describe, expect, it } from "vitest";
import { describeProvenance, marketProvenance } from "./index";

describe("provenance", () => {
  it("describes kind, source and age", () => {
    const now = Date.UTC(2026, 10, 17, 12);
    expect(describeProvenance({ kind: "market", source: "poe.ninja", at: now - 5 * 60_000 }, now)).toBe("Live · poe.ninja · 5 min ago");
    expect(describeProvenance({ kind: "estimate", source: "Vaalytics", at: null }, now)).toBe("Estimate · Vaalytics");
    expect(describeProvenance({ kind: "market", source: "poe.ninja", at: null }, now)).toBe("Live · poe.ninja · not loaded yet");
  });

  it("takes source and fetch time from a market snapshot", () => {
    const p = marketProvenance(
      { category: "currency", baseUnit: "chaos", source: "poe.ninja", items: [], fetchedAt: 1_700_000_000, expiresAt: null, lastError: null, lastErrorAt: null, refreshing: false },
      "Covens",
    );
    expect(p).toEqual({ kind: "market", source: "poe.ninja", at: 1_700_000_000_000, league: "Covens" });
  });
});
