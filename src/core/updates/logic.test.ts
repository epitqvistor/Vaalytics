import { describe, expect, it } from "vitest";
import type { UpdChange, UpdDatasetStatus, UpdModuleRegistration, UpdOverview } from "@/core/ipc/commands";
import { changeHeadline, fieldDiff, freshness, groupChanges, moduleStatus, overviewCounts, scheduleLabel } from "./logic";

const NOW = 1_800_000_000;

function ds(over: Partial<UpdDatasetStatus> & { kind?: "versioned" | "managed" | "bundled"; id?: string } = {}): UpdDatasetStatus {
  const { kind = "versioned", id = "poe1.divination-cards", ...rest } = over;
  return {
    def: { id, game: "poe1", label: id, category: id.split(".")[1] ?? "", providerId: "repoe-poe1", kind, policy: "auto", group: "gameData", format: 1, minEntries: 1, requiredFields: [], description: "" },
    consumers: [],
    installed: {
      id: 1, datasetId: id, game: "poe1", league: null, format: 1, label: "abc", contentHash: "abc", entryCount: 1, providerId: "x", sourceUrl: null, sourceVersion: null,
      retrievedAt: NOW - 10 * 86400, createdAt: NOW - 10 * 86400, installedAt: NOW - 10 * 86400, status: "installed", origin: "source", validation: "passed", validationNotes: [], parentId: null, hasContent: true,
    },
    staged: null,
    state: { sourceModified: null, lastCheckedAt: NOW - 3600, lastError: null },
    pending: 0,
    pendingReview: 0,
    market: null,
    cacheWrittenAt: null,
    intervalSecs: 86400,
    ...rest,
  };
}

describe("freshness", () => {
  it("separates retrieval from data freshness", () => {
    expect(freshness(ds(), NOW)).toBe("fresh");
    expect(freshness(ds({ state: { sourceModified: null, lastCheckedAt: NOW - 3 * 86400, lastError: "HTTP 503" } }), NOW)).toBe("stale");
    expect(freshness(ds({ installed: null }), NOW)).toBe("unknown");
    const recent = ds();
    recent.installed!.installedAt = NOW - 600;
    expect(freshness(recent, NOW)).toBe("recent");
    expect(freshness(ds({ kind: "bundled" }), NOW)).toBe("bundled");
  });
  it("uses the owning engine's state for managed datasets", () => {
    const m = (newest: number | null, errors = 0) => ds({ kind: "managed", market: { league: "X", categories: 3, oldestFetch: newest, newestFetch: newest, errors, lastError: null, items: 10 } });
    expect(freshness(m(NOW - 600), NOW)).toBe("fresh");
    expect(freshness(m(NOW - 5 * 3600, 1), NOW)).toBe("stale");
    expect(freshness(m(null), NOW)).toBe("unknown");
    expect(freshness(ds({ kind: "managed", cacheWrittenAt: NOW - 86400 }), NOW)).toBe("fresh");
    expect(freshness(ds({ kind: "managed", cacheWrittenAt: null }), NOW)).toBe("unknown");
  });
});

const reg = (required: string[]): UpdModuleRegistration => ({ moduleId: "deck-intelligence", game: "poe1", required, optional: [], autoUpdate: true, manualReview: false, note: "" });

describe("module status", () => {
  it("follows registered required datasets", () => {
    expect(moduleStatus(reg(["poe1.divination-cards"]), [ds()], NOW).state).toBe("ok");
    expect(moduleStatus(reg(["poe1.divination-cards"]), [ds({ pending: 3 })], NOW).state).toBe("pending");
    expect(moduleStatus(reg(["poe1.divination-cards"]), [ds({ installed: null })], NOW).state).toBe("missing");
    expect(moduleStatus(reg(["poe1.campaign"]), [ds({ kind: "bundled", id: "poe1.campaign" })], NOW).state).toBe("bundled");
  });
  it("counts outdated datasets and modules for the overview", () => {
    const o = {
      now: NOW,
      datasets: [ds({ pending: 2, pendingReview: 1 }), ds({ kind: "bundled", id: "poe1.campaign" })],
      sources: [
        { meta: {} as never, state: { providerId: "a", enabled: true, status: "ok" }, datasets: [] },
        { meta: {} as never, state: { providerId: "b", enabled: true, status: "error" }, datasets: [] },
        { meta: {} as never, state: { providerId: "c", enabled: false, status: "error" }, datasets: [] },
      ],
      modules: [reg(["poe1.divination-cards"]), reg(["poe1.campaign"])],
    } as unknown as UpdOverview;
    expect(overviewCounts(o)).toEqual({ sources: 3, sourcesOk: 1, sourcesFailed: 1, pending: 2, pendingReview: 1, outdatedDatasets: 1, outdatedModules: 1 });
  });
});

const change = (over: Partial<UpdChange>): UpdChange => ({
  id: 1, checkId: 1, versionId: 1, datasetId: "poe1.divination-cards", game: "poe1", entryKey: "A", entryName: "A", changeType: "added", fields: [],
  before: null, after: null, confidence: "confirmed", requiresReview: false, status: "pending", reviewed: false, detectedAt: 0, resolvedAt: null, ...over,
});

describe("changes", () => {
  it("names changes by dataset", () => {
    expect(changeHeadline(change({}))).toBe("New Divination Card");
    expect(changeHeadline(change({ datasetId: "poe2.leagues", changeType: "deprecated" }))).toBe("League ended");
    expect(changeHeadline(change({ changeType: "structural" }))).toMatch(/Manual review/);
  });
  it("groups and diffs", () => {
    const g = groupChanges([change({}), change({ id: 2, game: "poe2", datasetId: "poe2.leagues" })], "game", (x) => x);
    expect(g.map((x) => [x.key, x.items.length])).toEqual([["poe1", 1], ["poe2", 1]]);
    const d = fieldDiff({ fields: ["reward"], before: { name: "A", data: { reward: "1x", legacy: false } }, after: { name: "A", data: { reward: "2x", legacy: false } } });
    expect(d).toEqual([
      { field: "legacy", before: "false", after: "false", changed: false },
      { field: "reward", before: "1x", after: "2x", changed: true },
    ]);
    expect(fieldDiff({ fields: [], before: null, after: { name: "A", data: { x: null } } })[0]).toEqual({ field: "x", before: "—", after: "none", changed: true });
  });
  it("labels schedules", () => {
    expect(scheduleLabel("24h")).toBe("Once per day");
    expect(scheduleLabel("6h")).toBe("Every 6 hours");
    expect(scheduleLabel("manual")).toBe("Manual only");
  });
});
