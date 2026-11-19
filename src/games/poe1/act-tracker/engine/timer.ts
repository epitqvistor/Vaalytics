/**
 * Campaign timer (pure): time per campaign, act, area, town and away from the campaign, from Client.txt
 * timestamps only.
 *
 * The log has no "stopped playing" line, so time is ESTIMATED the same way as Campaign Intelligence (PoE 2):
 * active time = the sum of gaps between consecutive log events of this character; a gap longer than BREAK_GAP_S
 * is a break (client closed, AFK) and isn't counted. Every number from here is labelled as an estimate in the UI.
 *
 * - Town = the act towns. Away = after leaving the campaign the hook stores only the FIRST non-campaign area
 *   (hideout, Labyrinth, map…), so the whole time away is attributed to it: "hideout" when that area is a hideout,
 *   "away" otherwise. Nothing is guessed about what happened there.
 * - An act starts at the first entry into one of its areas and is finished at the first entry into a later act
 *   (Act 10: Karui Shores). An act is TIMED (comparable between runs) only when the log covers it from start to
 *   finish without a jump: it started at the act's first area or right after the previous act, which was timed too.
 */
import type { CampaignEventRow } from "@/core/ipc/commands";
import type { CampaignArea } from "@/games/poe1/location-atlas/data/types";
import type { RouteData } from "../data/types";

export const BREAK_GAP_S = 30 * 60;

export type SpanKind = "area" | "town" | "hideout" | "away";

export interface ActTime {
  act: number;
  firstAt: number;
  /** First entry into a later act; null while the act is in progress. */
  finishedAt: number | null;
  activeSeconds: number;
  townSeconds: number;
  /** The log covers the whole act, so it can be compared with other runs. */
  timed: boolean;
}

export interface AreaTime {
  area: string;
  act: number | null;
  kind: SpanKind;
  visits: number;
  activeSeconds: number;
}

export interface CampaignTimes {
  startedAt: number | null;
  /** Karui Shores entered from Act 10. */
  finishedAt: number | null;
  /** The log starts at The Twilight Strand (a new character), so the total covers the whole campaign. */
  fromStart: boolean;
  /** Active time inside Acts 1–10 (areas + towns), plus time away while the campaign was in progress. */
  campaignSeconds: number;
  townSeconds: number;
  hideoutSeconds: number;
  awaySeconds: number;
  acts: ActTime[];
  areas: AreaTime[];
  /** Average active time per non-town campaign area visit. */
  averageAreaSeconds: number | null;
  breaks: number;
  /** The area you're in now and since when (for a live timer), if any. */
  current: { area: string; kind: SpanKind; since: number; act: number | null } | null;
  lastAt: number | null;
}

const END_TOWN = "2_11_endgame_town";
const isHideout = (id: string) => /hideout/i.test(id);

export function campaignTimes(events: readonly CampaignEventRow[], areas: ReadonlyMap<string, CampaignArea>, route: RouteData): CampaignTimes {
  const actOf = (id: string) => areas.get(id)?.act ?? null;
  const kindOf = (id: string): SpanKind => {
    const a = areas.get(id);
    if (a) return a.kind === "town" ? "town" : "area";
    if (route.extraAreas[id]?.town) return "town";
    return isHideout(id) ? "hideout" : "away";
  };

  const acts = new Map<number, ActTime>();
  const areaTimes = new Map<string, AreaTime>();
  let current: CampaignTimes["current"] = null;
  let prevAt: number | null = null;
  let startedAt: number | null = null;
  let finishedAt: number | null = null;
  let fromStart = false;
  let campaign = 0;
  let town = 0;
  let hideout = 0;
  let away = 0;
  let breaks = 0;
  let act: number | null = null; // the act the campaign is in (towns and away time count towards it)
  let lastAt: number | null = null;

  for (const e of events) {
    if (prevAt !== null && current && finishedAt === null) {
      const gap = e.at - prevAt;
      if (gap > BREAK_GAP_S) breaks++;
      else if (gap > 0) {
        campaign += gap;
        const at = areaTimes.get(current.area)!;
        at.activeSeconds += gap;
        if (current.kind === "town") town += gap;
        if (current.kind === "hideout") hideout += gap;
        if (current.kind === "away") away += gap;
        if (act !== null) {
          const a = acts.get(act)!;
          a.activeSeconds += gap;
          if (current.kind === "town") a.townSeconds += gap;
        }
      }
    }
    prevAt = e.at;
    lastAt = e.at;
    if (e.kind !== "zone" || !e.areaId || finishedAt !== null) continue;
    const id = e.areaId;
    const kind = kindOf(id);
    const areaAct = actOf(id);
    if (id === END_TOWN && act === 10) {
      finishedAt = e.at;
      const a = acts.get(10);
      if (a) a.finishedAt = e.at;
      current = null;
      continue;
    }
    if (kind === "area" || kind === "town") {
      if (startedAt === null && areaAct !== null) {
        startedAt = e.at;
        fromStart = id === "1_1_1";
      }
      if (areaAct !== null && (act === null || areaAct > act)) {
        // A later act starts: the acts before it are finished now.
        for (const a of acts.values()) if (a.finishedAt === null) a.finishedAt = e.at;
        const prev = act !== null ? acts.get(act) : undefined;
        const firstAreaOfAct = (areaAct === 1 && id === "1_1_1") || (prev?.timed === true && areaAct === (prev?.act ?? 0) + 1);
        acts.set(areaAct, { act: areaAct, firstAt: e.at, finishedAt: null, activeSeconds: 0, townSeconds: 0, timed: firstAreaOfAct });
        act = areaAct;
      }
    }
    if (startedAt === null) continue; // away time before the campaign isn't campaign time
    if (!areaTimes.has(id)) areaTimes.set(id, { area: id, act: areaAct, kind, visits: 0, activeSeconds: 0 });
    areaTimes.get(id)!.visits++;
    current = { area: id, kind, since: e.at, act: areaAct };
  }
  // An act is only comparable once it is finished.
  for (const a of acts.values()) if (a.finishedAt === null) a.timed = false;

  const fieldVisits = [...areaTimes.values()].filter((a) => a.kind === "area");
  const visits = fieldVisits.reduce((n, a) => n + a.visits, 0);
  return {
    startedAt,
    finishedAt,
    fromStart,
    campaignSeconds: campaign,
    townSeconds: town,
    hideoutSeconds: hideout,
    awaySeconds: away,
    acts: [...acts.values()].sort((a, b) => a.act - b.act),
    areas: [...areaTimes.values()].sort((a, b) => b.activeSeconds - a.activeSeconds),
    averageAreaSeconds: visits ? fieldVisits.reduce((n, a) => n + a.activeSeconds, 0) / visits : null,
    breaks,
    current,
    lastAt,
  };
}

/**
 * Live seconds to add for the time since the last log event, while you're still in an area: only if the last event
 * is recent (within the break gap) — otherwise the game is probably closed and the timer is paused.
 */
export function liveExtra(t: CampaignTimes, now: number): number {
  if (!t.current || t.finishedAt !== null || t.lastAt === null) return 0;
  const gap = now - t.lastAt;
  return gap > 0 && gap <= BREAK_GAP_S ? gap : 0;
}

export function formatDuration(s: number): string {
  const sec = Math.max(0, Math.round(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- history across characters

export interface RunSummary {
  characterId: number;
  name: string;
  class: string;
  level: number;
  times: CampaignTimes;
  /** Quest passive points received in the log (point lines). */
  pointsInLog: number;
  /** Quest points per the character's last `/passives`, if any. */
  pointsFromPassives: number | null;
  deaths: number;
  /** Steps the player marked skipped / done. */
  skipped: number;
  confirmed: number;
}

export interface ActRecord {
  act: number;
  /** Fastest timed act among the runs. */
  best: { characterId: number; seconds: number } | null;
}

/** Fastest timed time per act across runs (only acts the log covers fully). */
export function bestActs(runs: readonly RunSummary[]): ActRecord[] {
  return Array.from({ length: 10 }, (_, k) => k + 1).map((act) => {
    let best: ActRecord["best"] = null;
    for (const r of runs) {
      const a = r.times.acts.find((x) => x.act === act && x.timed);
      if (a && (!best || a.activeSeconds < best.seconds)) best = { characterId: r.characterId, seconds: a.activeSeconds };
    }
    return { act, best };
  });
}
