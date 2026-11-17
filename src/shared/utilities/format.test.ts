import { describe, expect, it } from "vitest";
import { formatAmount, formatBytes, formatCompact, formatChange, formatDuration, formatRelative } from "./format";

describe("formatBytes", () => {
  it("formats across units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50.0 MB");
  });
  it("handles missing or invalid values", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("picks the coarsest useful unit", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(3 * 3600 + 120)).toBe("3h 2m");
  });
});

describe("formatAmount", () => {
  it("scales precision with magnitude", () => {
    expect(formatAmount(0.1234)).toBe("0.123");
    expect(formatAmount(4.256)).toBe("4.26");
    expect(formatAmount(42.26)).toBe("42.3");
    expect(formatAmount(1234.6)).toBe("1,235");
  });
});

describe("formatChange", () => {
  it("signs and rounds", () => {
    expect(formatChange(0.042)).toBe("+4.2%");
    expect(formatChange(-0.1)).toBe("−10.0%");
    expect(formatChange(0.0001)).toBe("0.0%");
  });
});

describe("formatRelative", () => {
  const now = 1_000_000_000;
  it("buckets durations", () => {
    expect(formatRelative(now - 10_000, now)).toBe("just now");
    expect(formatRelative(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe("2 d ago");
  });
});

describe("formatCompact", () => {
  it("abbreviates only large values", () => {
    expect(formatCompact(182)).toBe("182");
    expect(formatCompact(12_500)).toBe("12.5k");
    expect(formatCompact(410_000)).toBe("410k");
    expect(formatCompact(2_400_000)).toBe("2.4M");
  });
});
