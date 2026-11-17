import { describe, expect, it } from "vitest";
import { hostOf, toUrl } from "./address";

describe("address bar", () => {
  it("keeps URLs, upgrades bare domains, searches the rest", () => {
    expect(toUrl("https://poe.ninja/builds")).toBe("https://poe.ninja/builds");
    expect(toUrl("pathofexile.com/trade")).toBe("https://pathofexile.com/trade");
    expect(toUrl("best league starter")).toBe("https://www.google.com/search?q=best%20league%20starter");
    expect(toUrl("divine orb price")).toContain("google.com/search");
    expect(toUrl("   ")).toBeNull();
  });
  it("refuses non-web schemes", () => {
    expect(toUrl("javascript:alert(1)")).toBeNull();
    expect(toUrl("file:///C:/x")).toBeNull();
  });
  it("labels tabs by host", () => {
    expect(hostOf("https://www.pathofexile.com/trade")).toBe("pathofexile.com");
    expect(hostOf(null)).toBe("Start page");
  });
});
