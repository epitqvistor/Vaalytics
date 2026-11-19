/**
 * Dataset validation. Invalid or partial data must never crash the Atlas: the loader runs this and the UI
 * shows the problems instead of the affected parts.
 */
import type { ActData, AtlasDataset } from "./types";

export interface ValidationIssue {
  severity: "error" | "warning";
  where: string;
  message: string;
}

const AREA_ID = /^[12]_\d+_[A-Za-z0-9_]+$/;

export function validateAct(act: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (where: string, message: string) => issues.push({ severity: "error", where, message });
  if (!act || typeof act !== "object") return [{ severity: "error", where: "act", message: "not an object" }];
  const a = act as Partial<ActData>;
  if (typeof a.act !== "number" || a.act < 1 || a.act > 10) err("act", "act number must be 1–10");
  if (!Array.isArray(a.areas) || !Array.isArray(a.hints) || !Array.isArray(a.quests)) {
    err(`act ${a.act}`, "areas, hints and quests must be arrays");
    return issues;
  }
  for (const ar of a.areas) {
    const w = `area ${ar?.id ?? "?"}`;
    if (typeof ar?.id !== "string" || !AREA_ID.test(ar.id)) err(w, "invalid area id");
    if (typeof ar?.name !== "string" || !ar.name) err(w, "missing name");
    if (ar?.act !== a.act) err(w, `belongs to act ${ar?.act}, listed in act ${a.act}`);
    if (typeof ar?.level !== "number" || ar.level < 1 || ar.level > 100) err(w, "invalid area level");
    if (ar?.kind !== "town" && ar?.kind !== "area") err(w, "invalid kind");
    if (!Array.isArray(ar?.connections) || !Array.isArray(ar?.topologies)) err(w, "connections/topologies must be arrays");
  }
  return issues;
}

/** Whole-dataset checks: unique ids, references, towns, hints. */
export function validateDataset(ds: AtlasDataset): ValidationIssue[] {
  const issues: ValidationIssue[] = ds.acts.flatMap(validateAct);
  const err = (where: string, message: string) => issues.push({ severity: "error", where, message });
  const warn = (where: string, message: string) => issues.push({ severity: "warning", where, message });
  const areas = new Map<string, ActData["areas"][number]>();
  for (const act of ds.acts) {
    for (const a of act.areas) {
      if (areas.has(a.id)) err(`area ${a.id}`, "duplicate id");
      areas.set(a.id, a);
    }
  }
  const quests = new Set<string>();
  for (const act of ds.acts) {
    if (!act.areas.some((a) => a.kind === "town")) err(`act ${act.act}`, "has no town");
    for (const q of act.quests) {
      if (quests.has(q.id)) err(`quest ${q.id}`, "duplicate id");
      quests.add(q.id);
    }
    for (const h of act.hints) {
      if (!areas.has(h.area)) err(`hint in act ${act.act}`, `unknown area ${h.area}`);
      if (h.toward && !areas.has(h.toward)) err(`hint in act ${act.act}`, `unknown target area ${h.toward}`);
      if (h.direction !== undefined && (h.direction < 0 || h.direction >= 360)) err(`hint in ${h.area}`, "direction out of range");
    }
  }
  for (const a of areas.values()) {
    for (const c of a.connections) {
      const other = areas.get(c);
      if (!other) err(`area ${a.id}`, `connection to unknown area ${c}`);
      // One-way transitions exist in the game (e.g. a drop you can't climb back); report, don't fail.
      else if (!other.connections.includes(a.id)) warn(`area ${a.id}`, `one-way connection to ${c}`);
    }
    if (a.town && !areas.has(a.town)) err(`area ${a.id}`, `unknown town ${a.town}`);
    if (a.kind === "area" && a.topologies.length === 0) warn(`area ${a.id}`, "no layout topology in the game data");
  }
  if (ds.meta.counts.areas !== areas.size) err("meta", `counts.areas ${ds.meta.counts.areas} ≠ ${areas.size}`);
  if (!ds.meta.sources.length) err("meta", "no sources");
  for (const s of ds.meta.sources) if (!s.url || !s.license) err(`source ${s.id}`, "url and license are required");
  return issues;
}
