import { beforeEach, describe, expect, it } from "vitest";
import type { TradePriceCheck } from "@/core/ipc/commands";
import { clearResultCache, getCachedResult, putCachedResult, resultKey, RESULT_TTL_MS } from "./resultCache";

const result = { searchId: "s", total: 1, tradeUrl: "", listings: [], hasMore: false, baseUnit: "chaos", ratesAvailable: true } satisfies TradePriceCheck;

describe("price-check result cache", () => {
  beforeEach(clearResultCache);

  it("keys by game, league and the exact query", () => {
    const q = { query: { type: "Exalted Orb" } };
    expect(resultKey("poe1", "Covens", q)).not.toBe(resultKey("poe2", "Covens", q));
    expect(resultKey("poe1", "Covens", q)).not.toBe(resultKey("poe1", "Standard", q));
    expect(resultKey("poe1", "Covens", q)).not.toBe(resultKey("poe1", "Covens", { query: { type: "Exalted Orb", stats: [] } }));
  });

  it("expires entries after the TTL", () => {
    putCachedResult("k", { result, listings: [], at: 1000 });
    expect(getCachedResult("k", 1000 + RESULT_TTL_MS)).not.toBeNull();
    expect(getCachedResult("k", 1001 + RESULT_TTL_MS)).toBeNull();
  });
});
