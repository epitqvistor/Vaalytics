import { describe, expect, it } from "vitest";
import { CHANGELOG, changelogFor, compareVersions, type ChangelogEntry } from "./changelog";

describe("compareVersions", () => {
  it("compares numerically", () => {
    expect(compareVersions("0.20.10", "0.20.9")).toBeGreaterThan(0);
    expect(compareVersions("0.20.2", "0.20.2")).toBe(0);
    expect(compareVersions("0.19.0", "0.20.0")).toBeLessThan(0);
  });
});

describe("changelogFor", () => {
  const entries: ChangelogEntry[] = [
    { version: "0.22.0", date: "2026-12-01", title: "future", changes: [] },
    { version: "0.21.0", date: "2026-11-26", title: "wip", changes: [], unreleased: true },
    { version: "0.20.2", date: "2026-11-26", title: "current", changes: [] },
    { version: "0.20.1", date: "2026-11-26", title: "older", changes: [] },
  ];

  it("shows released entries up to the running version plus unreleased ones", () => {
    expect(changelogFor("0.20.2", entries).map((e) => e.title)).toEqual(["wip", "current", "older"]);
  });

  it("never shows a released entry newer than the build", () => {
    expect(changelogFor("0.20.1", entries).map((e) => e.title)).not.toContain("future");
  });
});

describe("CHANGELOG", () => {
  it("is newest first, with unique versions and at least one change each", () => {
    const versions = CHANGELOG.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let i = 1; i < versions.length; i++) expect(compareVersions(versions[i - 1]!, versions[i]!)).toBeGreaterThan(0);
    for (const e of CHANGELOG) expect(e.changes.length).toBeGreaterThan(0);
  });
});
