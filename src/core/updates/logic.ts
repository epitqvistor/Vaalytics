/**
 * Update Center — pure helpers for the UI: freshness, module status, change labels and
 * grouping. The backend decides what is valid and applied; this only presents it.
 * Spec: docs/modules/update-center.md
 */
import type { GameId } from "@/core/game-context/games";
import type { UpdChange, UpdDatasetStatus, UpdModuleRegistration, UpdOverview } from "@/core/ipc/commands";

export type Freshness = "fresh" | "recent" | "stale" | "unknown" | "bundled";

const DAY = 86_400;

/**
 * Freshness is about the *data*, not the download: a dataset is fresh when its source was
 * checked successfully within its schedule; recently updated when a new version was
 * installed in the last 24 h; stale when checks fail or are overdue.
 */
export function freshness(d: UpdDatasetStatus, now: number): Freshness {
  if (d.def.kind === "bundled") return "bundled";
  if (d.def.kind === "managed") {
    if (d.market) {
      if (d.market.newestFetch == null) return "unknown";
      if (d.market.errors > 0 && now - d.market.newestFetch > 2 * 3600) return "stale";
      return now - d.market.newestFetch <= 2 * 3600 ? "fresh" : "stale";
    }
    if (d.cacheWrittenAt == null) return "unknown";
    return now - d.cacheWrittenAt <= 2 * DAY ? "fresh" : "stale";
  }
  if (!d.installed) return "unknown";
  if (d.installed.installedAt != null && now - d.installed.installedAt <= DAY) return "recent";
  const checked = d.state.lastCheckedAt;
  if (checked == null) return "unknown";
  const allowed = (d.intervalSecs ?? DAY) * 1.5;
  if (now - checked > Math.max(allowed, 6 * 3600)) return "stale";
  return "fresh";
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: "Fresh",
  recent: "Recently updated",
  stale: "Stale",
  unknown: "Unknown",
  bundled: "Bundled",
};

export type ModuleState = "ok" | "pending" | "stale" | "missing" | "bundled";

export interface ModuleStatus {
  reg: UpdModuleRegistration;
  state: ModuleState;
  reasons: string[];
}

/** Status of a module from the datasets it registered (required ones decide). */
export function moduleStatus(reg: UpdModuleRegistration, datasets: UpdDatasetStatus[], now: number): ModuleStatus {
  const reasons: string[] = [];
  let state: ModuleState = "ok";
  const rank: Record<ModuleState, number> = { ok: 0, bundled: 1, pending: 2, stale: 3, missing: 4 };
  const bump = (s: ModuleState) => {
    if (rank[s] > rank[state]) state = s;
  };
  for (const id of reg.required) {
    const d = datasets.find((x) => x.def.id === id);
    if (!d) continue;
    const f = freshness(d, now);
    if (d.def.kind === "versioned" && !d.installed) {
      bump("missing");
      reasons.push(`${d.def.label}: not installed`);
    } else if (d.pending > 0) {
      bump("pending");
      reasons.push(`${d.def.label}: ${d.pending} pending change${d.pending === 1 ? "" : "s"}`);
    } else if (f === "stale") {
      bump("stale");
      reasons.push(`${d.def.label}: stale`);
    } else if (f === "bundled") {
      bump("bundled");
    }
  }
  return { reg, state, reasons };
}

export function isOutdated(s: ModuleStatus): boolean {
  return s.state === "pending" || s.state === "stale" || s.state === "missing";
}

export interface OverviewCounts {
  sources: number;
  sourcesOk: number;
  sourcesFailed: number;
  pending: number;
  pendingReview: number;
  outdatedDatasets: number;
  outdatedModules: number;
}

export function overviewCounts(o: UpdOverview): OverviewCounts {
  const enabled = o.sources.filter((s) => s.state.enabled);
  const statuses = o.modules.map((m) => moduleStatus(m, o.datasets, o.now));
  return {
    sources: o.sources.length,
    sourcesOk: enabled.filter((s) => s.state.status === "ok" || s.state.status === "warning").length,
    sourcesFailed: enabled.filter((s) => s.state.status === "error").length,
    pending: o.datasets.reduce((n, d) => n + d.pending, 0),
    pendingReview: o.datasets.reduce((n, d) => n + d.pendingReview, 0),
    outdatedDatasets: o.datasets.filter((d) => d.def.kind !== "bundled" && (d.pending > 0 || freshness(d, o.now) === "stale" || (d.def.kind === "versioned" && !d.installed))).length,
    outdatedModules: new Set(statuses.filter(isOutdated).map((s) => `${s.reg.game}:${s.reg.moduleId}`)).size,
  };
}

/** Readable headline for a change, e.g. "New Divination Card", "League ended". */
export function changeHeadline(c: Pick<UpdChange, "changeType" | "datasetId" | "requiresReview">): string {
  if (c.changeType === "structural") return "Manual review required — data structure changed";
  const cat = c.datasetId.split(".")[1] ?? "";
  const noun = cat === "divination-cards" ? "Divination Card" : cat === "leagues" ? "League" : "Entry";
  switch (c.changeType) {
    case "added":
      return `New ${noun}`;
    case "removed":
      return `${noun} removed`;
    case "deprecated":
      return cat === "leagues" ? "League ended" : `${noun} became legacy`;
    case "description_updated":
      return cat === "divination-cards" ? "Card reward changed" : "Description updated";
    case "reclassified":
      return "Reclassified";
    case "price_updated":
      return "Price dataset updated";
    case "metadata_updated":
      return "Metadata updated";
    case "modified":
      return `${noun} changed`;
    default:
      return "Unknown change";
  }
}

export const CHANGE_TYPE_LABEL: Record<UpdChange["changeType"], string> = {
  added: "Added",
  modified: "Modified",
  removed: "Removed",
  deprecated: "Deprecated",
  reclassified: "Reclassified",
  price_updated: "Price updated",
  description_updated: "Description updated",
  metadata_updated: "Metadata updated",
  structural: "Structural change",
  unknown: "Unknown",
};

export const CONFIDENCE_LABEL: Record<UpdChange["confidence"], string> = {
  confirmed: "Confirmed",
  high: "High confidence",
  review: "Needs review",
  unverified: "Unverified",
};

export type GroupBy = "dataset" | "game" | "type" | "confidence" | "status";

export function groupChanges(changes: UpdChange[], by: GroupBy, labelOf: (datasetId: string) => string): { key: string; label: string; items: UpdChange[] }[] {
  const keyOf = (c: UpdChange): [string, string] => {
    switch (by) {
      case "game":
        return [c.game, c.game === "poe1" ? "Path of Exile 1" : "Path of Exile 2"];
      case "type":
        return [c.changeType, CHANGE_TYPE_LABEL[c.changeType]];
      case "confidence":
        return [c.confidence, CONFIDENCE_LABEL[c.confidence]];
      case "status":
        return [c.requiresReview ? "review" : "safe", c.requiresReview ? "Needs your review" : "Safe to apply"];
      default:
        return [c.datasetId, labelOf(c.datasetId)];
    }
  };
  const map = new Map<string, { key: string; label: string; items: UpdChange[] }>();
  for (const c of changes) {
    const [key, label] = keyOf(c);
    const g = map.get(key) ?? { key, label, items: [] };
    g.items.push(c);
    map.set(key, g);
  }
  return [...map.values()];
}

/** Field-level before/after rows for a structured change. */
export function fieldDiff(c: Pick<UpdChange, "before" | "after" | "fields">): { field: string; before: string; after: string; changed: boolean }[] {
  const b = c.before?.data ?? {};
  const a = c.after?.data ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  const show = (v: unknown) => (v === undefined ? "—" : v === null ? "none" : typeof v === "string" ? v || "“”" : JSON.stringify(v));
  return keys.map((k) => ({ field: k, before: show(b[k]), after: show(a[k]), changed: JSON.stringify(b[k]) !== JSON.stringify(a[k]) }));
}

export const GAME_LABEL: Record<GameId, string> = { poe1: "PoE 1", poe2: "PoE 2" };

/** Human label for a schedule mode stored in settings. */
export function scheduleLabel(mode: string): string {
  if (mode === "manual") return "Manual only";
  if (mode === "startup") return "On app startup";
  const h = /^(\d+)h$/.exec(mode)?.[1];
  if (!h) return mode;
  if (h === "24") return "Once per day";
  return `Every ${h} hours`;
}
