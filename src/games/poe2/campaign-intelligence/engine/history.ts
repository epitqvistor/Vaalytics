/**
 * Run history and performance (pure): time per part, deaths, levels, a
 * timeline of what happened, and a comparison of runs across characters.
 *
 * Time comes only from Client.txt timestamps. The log has no "game closed"
 * line in the campaign events, so "active time" is the sum of gaps between
 * consecutive events while you were in a campaign area; a gap longer than
 * BREAK_GAP_S is treated as a break (client closed, AFK) and not counted.
 * It is an estimate and is labelled as one in the UI.
 */
import type { PartId } from "../data/types";
import { type CampaignGraph, zoneFor } from "./graph";
import type { CampaignEvent, CampaignProgress } from "./progress";

/** Gaps longer than this between two log events count as a break. */
export const BREAK_GAP_S = 30 * 60;

export interface PartStats {
  part: PartId;
  /** First time you entered an area of this part. */
  firstAt: number | null;
  /** When the part was finished (null if not, or only marked manually). */
  finishedAt: number | null;
  finished: boolean;
  /**
   * The log covers the whole part, so its time can be compared: finished, and either
   * Act 1 from a new character (first level-up ≤ 2) or the previous part timed and its
   * finish seen in this log. A log that starts mid-campaign has no timed parts.
   */
  timed: boolean;
  /** Estimated active time in this part's areas (seconds). */
  activeSeconds: number;
  deaths: number;
  levelIn: number | null;
  levelOut: number | null;
}

export interface ZoneStats {
  zone: string;
  visits: number;
  activeSeconds: number;
  deaths: number;
  lastAt: number;
}

export interface RunStats {
  parts: PartStats[];
  zones: Map<string, ZoneStats>;
  /** Acts 1–4 active time; null until all four are finished and timed. */
  campaignSeconds: number | null;
  /** All three Interludes' active time; null until all are finished and timed. */
  interludeSeconds: number | null;
  activeSeconds: number;
  /** Active time in towns. */
  townSeconds: number;
  /**
   * Backtracking: active time in an area you had already moved on from (you went on
   * to another non-town area, then came back). Town portal trips don't count.
   */
  revisitSeconds: number;
  deaths: number;
  startedAt: number | null;
  lastAt: number | null;
  breaks: number;
}

export type TimelineKind = "part" | "objective" | "ascended" | "death" | "level";
export interface TimelineEntry {
  at: number;
  kind: TimelineKind;
  text: string;
  /** Dataset zone id where it happened, if known. */
  zone: string | null;
  /** Objective entries: how it was detected. */
  manual?: boolean;
}

const ACTS: PartId[] = ["act1", "act2", "act3", "act4"];
const INTERLUDES: PartId[] = ["int1", "int2", "int3"];

/** The part whose opening gate finishes this one (Act 4 ends where the Interludes open). */
const OPENS_NEXT: Partial<Record<PartId, PartId>> = { act1: "act2", act2: "act3", act3: "act4", act4: "int1" };
/** The part that must be seen entered and finished in the log for this one to be fully logged. */
const PREVIOUS: Partial<Record<PartId, PartId>> = { act2: "act1", act3: "act2", act4: "act3", int1: "act4", int2: "act4", int3: "act4" };

/** When a part counts as finished: the gate objective(s) that open the next part (acts), or all its main objectives (Interludes). */
function finishOf(g: CampaignGraph, progress: CampaignProgress, part: PartId): { finished: boolean; at: number | null } {
  const next = OPENS_NEXT[part];
  const ids = next ? g.part.get(next)!.opensAfter : g.dataset.objectives.filter((o) => o.part === part && o.kind === "main").map((o) => o.id);
  if (!ids.length) return { finished: false, at: null };
  const ps = ids.map((id) => progress.objectives.get(id));
  if (!ps.every((p) => p?.status === "done")) return { finished: false, at: null };
  // A manual mark's time is when you clicked, not when you played it; a requirement-implied one has no time of its own.
  if (ps.some((p) => p!.source === "manual" || p!.at == null)) return { finished: true, at: null };
  return { finished: true, at: Math.max(...ps.map((p) => p!.at!)) };
}

export function runStats(g: CampaignGraph, events: readonly CampaignEvent[], progress: CampaignProgress): RunStats {
  const parts = new Map<PartId, PartStats>(
    g.dataset.parts.map((p) => [p.id, { part: p.id, firstAt: null, finishedAt: null, finished: false, timed: false, activeSeconds: 0, deaths: 0, levelIn: null, levelOut: null }]),
  );
  const zones = new Map<string, ZoneStats>();
  let current: string | null = null;
  let prevAt: number | null = null;
  let level: number | null = null;
  let active = 0;
  let deaths = 0;
  let breaks = 0;
  let startedAt: number | null = null;
  let firstLevel: number | null = null;
  let town = 0;
  let revisit = 0;
  /** Non-town areas you have moved on from; re-entering one is backtracking. */
  const movedOn = new Set<string>();
  let lastField: string | null = null;
  let revisiting = false;
  const levelAt: { at: number; level: number }[] = [];

  for (const e of events) {
    if (prevAt !== null && current) {
      const gap = e.at - prevAt;
      if (gap > BREAK_GAP_S) breaks++;
      else if (gap > 0) {
        active += gap;
        zones.get(current)!.activeSeconds += gap;
        parts.get(g.zone.get(current)!.part)!.activeSeconds += gap;
        if (g.zone.get(current)!.kind === "town") town += gap;
        else if (revisiting) revisit += gap;
      }
    }
    prevAt = e.at;
    switch (e.kind) {
      case "zone": {
        const z = zoneFor(g, e.areaId, e.name);
        current = z?.id ?? null;
        if (!z) break;
        startedAt ??= e.at;
        if (z.kind !== "town") {
          if (lastField && lastField !== z.id) movedOn.add(lastField);
          revisiting = movedOn.has(z.id);
          lastField = z.id;
        }
        const zs = zones.get(z.id) ?? { zone: z.id, visits: 0, activeSeconds: 0, deaths: 0, lastAt: e.at };
        zs.visits++;
        zs.lastAt = e.at;
        zones.set(z.id, zs);
        const ps = parts.get(z.part)!;
        if (ps.firstAt === null) {
          ps.firstAt = e.at;
          ps.levelIn = level;
        }
        break;
      }
      case "level":
        level = e.level;
        firstLevel ??= e.level;
        levelAt.push({ at: e.at, level: e.level });
        break;
      case "death":
        if (current) {
          deaths++;
          zones.get(current)!.deaths++;
          parts.get(g.zone.get(current)!.part)!.deaths++;
        }
        break;
      default:
        break;
    }
  }

  const levelBy = (at: number) => {
    let l: number | null = null;
    for (const x of levelAt) if (x.at <= at) l = x.level;
    return l;
  };
  for (const ps of parts.values()) {
    const f = finishOf(g, progress, ps.part);
    ps.finished = f.finished;
    ps.finishedAt = f.at;
    if (f.at !== null) ps.levelOut = levelBy(f.at);
  }
  // Parts are in campaign order, so the previous part is decided first.
  for (const ps of parts.values()) {
    const prev = PREVIOUS[ps.part];
    const covered = prev ? parts.get(prev)!.timed && parts.get(prev)!.finishedAt !== null : firstLevel !== null && firstLevel <= 2;
    ps.timed = ps.finished && ps.firstAt !== null && covered;
  }
  const all = (ids: PartId[]) => ids.every((p) => parts.get(p)!.timed);
  const sum = (ids: PartId[]) => ids.reduce((s, p) => s + parts.get(p)!.activeSeconds, 0);
  return {
    parts: [...parts.values()],
    zones,
    campaignSeconds: all(ACTS) ? sum(ACTS) : null,
    interludeSeconds: all(INTERLUDES) ? sum(INTERLUDES) : null,
    activeSeconds: active,
    townSeconds: town,
    revisitSeconds: revisit,
    deaths,
    startedAt,
    lastAt: prevAt,
    breaks,
  };
}

/** What happened, oldest first: parts entered, objectives credited, Ascendancy, deaths, every 5th level reached in a campaign area. */
export function campaignTimeline(g: CampaignGraph, events: readonly CampaignEvent[], progress: CampaignProgress): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const seenParts = new Set<PartId>();
  let current: string | null = null;
  for (const e of events) {
    if (e.kind === "zone") {
      const z = zoneFor(g, e.areaId, e.name);
      current = z?.id ?? null;
      if (z && !seenParts.has(z.part)) {
        seenParts.add(z.part);
        out.push({ at: e.at, kind: "part", text: `Entered ${g.part.get(z.part)!.name} (${z.name})`, zone: z.id });
      }
    } else if (e.kind === "death" && current) {
      out.push({ at: e.at, kind: "death", text: `Died in ${g.zone.get(current)!.name}`, zone: current });
    } else if (e.kind === "level" && e.level % 5 === 0 && current) {
      out.push({ at: e.at, kind: "level", text: `Reached level ${e.level}`, zone: current });
    } else if (e.kind === "ascended") {
      out.push({ at: e.at, kind: "ascended", text: `Ascended: ${e.fromClass} → ${e.toClass}`, zone: current });
    }
  }
  for (const o of g.dataset.objectives) {
    const p = progress.objectives.get(o.id);
    if (p?.status !== "done" || p.at == null) continue;
    out.push({ at: p.at, kind: "objective", text: o.title, zone: o.zone, manual: p.source === "manual" });
  }
  // Same second: an objective credited by entering a zone happened before that entry; otherwise log order.
  const rank = (k: TimelineKind) => (k === "objective" ? 0 : 1);
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => a.x.at - b.x.at || rank(a.x.kind) - rank(b.x.kind) || a.i - b.i)
    .map(({ x }) => x);
}

export interface RunRow {
  characterId: number;
  name: string;
  stats: RunStats;
}

/** Personal best (shortest active time) per column across runs; only finished, fully logged parts count. */
export function personalBests(rows: readonly RunRow[]): { parts: Map<PartId, number>; campaign: number | null; interludes: number | null } {
  const parts = new Map<PartId, number>();
  let campaign: number | null = null;
  let interludes: number | null = null;
  for (const r of rows) {
    for (const p of r.stats.parts) {
      if (!p.timed || p.activeSeconds <= 0) continue;
      const best = parts.get(p.part);
      if (best === undefined || p.activeSeconds < best) parts.set(p.part, p.activeSeconds);
    }
    if (r.stats.campaignSeconds && (campaign === null || r.stats.campaignSeconds < campaign)) campaign = r.stats.campaignSeconds;
    if (r.stats.interludeSeconds && (interludes === null || r.stats.interludeSeconds < interludes)) interludes = r.stats.interludeSeconds;
  }
  return { parts, campaign, interludes };
}

/** "1 h 05 min" / "12 min" / "45 s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
