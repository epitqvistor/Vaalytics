/**
 * Progress state engine (pure). Turns one character's normalised log events and
 * manual marks into a status per objective, with an honest confidence:
 *
 * - CONFIRMED — reserved for a direct, unambiguous signal about that objective
 *   (none of the verified Client.txt lines names a quest, so today this is never
 *   set for objectives; reward *amounts* received are confirmed separately).
 * - INFERRED  — derived from reliable signals: a zone that can only be reached
 *   after the objective; passive points received in the objective's claim zone;
 *   the class changing to an Ascendancy after a trial was visited.
 * - MANUAL    — set by the player.
 *
 * Entering a zone never completes an objective in that zone; leaving a zone
 * never completes it either.
 */
import type { PartId } from "../data/types";
import { type CampaignGraph, isCampaignAreaId, zoneFor } from "./graph";

export type CampaignEvent =
  | { kind: "zone"; at: number; areaId: string; name?: string | null; level?: number | null }
  /** "You have received N Passive Skill Points." (`weaponSet` for the "Weapon Set" variant). */
  | { kind: "passive-points"; at: number; amount: number; weaponSet: boolean }
  /** Level-up line whose class changed (e.g. Monk → Invoker). */
  | { kind: "ascended"; at: number; fromClass: string; toClass: string }
  | { kind: "level"; at: number; level: number }
  | { kind: "death"; at: number };

export type Confidence = "confirmed" | "inferred" | "manual";
export type ObjectiveStatus = "locked" | "available" | "done" | "skipped";

export interface ManualMark {
  objective: string;
  /** `not-done` overrides an inference the player says is wrong. */
  mark: "done" | "skipped" | "not-done";
  at: number;
  /** For choice rewards: the option the player picked. */
  choice?: string;
}

export interface ObjectiveProgress {
  id: string;
  status: ObjectiveStatus;
  confidence: Confidence | null;
  source: CreditSource | null;
  /** Why the engine believes this (plain language). */
  evidence: string | null;
  at: number | null;
  choice?: string;
}

export interface CampaignProgress {
  objectives: Map<string, ObjectiveProgress>;
  partOpen: Record<PartId, boolean>;
  /** Dataset zone ids entered at least once. */
  visited: Set<string>;
  currentZone: string | null;
  /** Area level of the current zone as logged. */
  currentAreaLevel: number | null;
  level: number | null;
  deaths: number;
  /** Campaign area ids from the log that the dataset doesn't know (patch drift). */
  unknownAreas: string[];
  /** Passive-point grants in campaign zones that couldn't be tied to an objective. */
  unattributedGrants: { at: number; zone: string | null; amount: number }[];
  ascended: { at: number; toClass: string } | null;
}

/** Which signal completed an objective. */
export type CreditSource = "zone-gate" | "passive-grant" | "ascended" | "requirement" | "manual";

interface Credit {
  source: CreditSource;
  confidence: Confidence;
  evidence: string;
  at: number | null;
}

export function deriveProgress(g: CampaignGraph, events: readonly CampaignEvent[], marks: readonly ManualMark[] = []): CampaignProgress {
  const credits = new Map<string, Credit>();
  const visited = new Set<string>();
  const unknown = new Set<string>();
  const unattributed: CampaignProgress["unattributedGrants"] = [];
  const recentTrial: string[] = [];
  let current: string | null = null;
  let currentAreaLevel: number | null = null;
  let level: number | null = null;
  let deaths = 0;
  let ascended: CampaignProgress["ascended"] = null;

  const credit = (id: string, c: Credit) => {
    if (!credits.has(id)) credits.set(id, c);
  };
  const isDone = (id: string) => credits.has(id);
  const partOpenNow = (part: PartId) => {
    const p = g.part.get(part)!;
    return p.opensAfter.every(isDone) || g.dataset.zones.some((z) => z.part === part && visited.has(z.id));
  };

  for (const e of events) {
    switch (e.kind) {
      case "zone": {
        const zone = zoneFor(g, e.areaId, e.name);
        if (!zone) {
          if (isCampaignAreaId(e.areaId)) unknown.add(e.areaId);
          current = null;
          currentAreaLevel = null;
          break;
        }
        current = zone.id;
        currentAreaLevel = e.level ?? null;
        if (!visited.has(zone.id)) {
          visited.add(zone.id);
          // The zone can only be reached after its gates and the part's gates.
          const why = `You entered ${zone.name}, which opens only after this.`;
          for (const o of zone.opensAfter ?? []) credit(o, { source: "zone-gate", confidence: "inferred", evidence: why, at: e.at });
          for (const o of g.part.get(zone.part)!.opensAfter) credit(o, { source: "zone-gate", confidence: "inferred", evidence: why, at: e.at });
        }
        if (zone.kind === "trial") {
          recentTrial.splice(0, recentTrial.length, zone.id);
        }
        break;
      }
      case "passive-points": {
        // Each grant is logged twice (regular + Weapon Set); attribute the regular line only.
        if (e.weaponSet) break;
        const target = attributeGrant(g, current, credits, partOpenNow, visited);
        if (target) {
          const zoneName = current ? g.zone.get(current)!.name : "this zone";
          credit(target, { source: "passive-grant", confidence: "inferred", evidence: `You received ${e.amount} Passive Skill Points in ${zoneName}, where this reward is claimed.`, at: e.at });
        } else if (current) {
          unattributed.push({ at: e.at, zone: current, amount: e.amount });
        }
        break;
      }
      case "ascended": {
        if (ascended) break;
        ascended = { at: e.at, toClass: e.toClass };
        const trialObjectives = g.dataset.objectives.filter((o) => o.detection?.kind === "ascended" && !isDone(o.id));
        const target =
          trialObjectives.find((o) => recentTrial.includes(o.zone)) ?? trialObjectives.find((o) => partOpenNow(o.part));
        if (target) {
          credit(target.id, {
            source: "ascended",
            confidence: "inferred",
            evidence: `Your class changed from ${e.fromClass} to ${e.toClass} — an Ascendancy was taken${recentTrial.includes(target.zone) ? " after visiting this trial" : ""}.`,
            at: e.at,
          });
        }
        break;
      }
      case "level":
        level = e.level;
        break;
      case "death":
        deaths += 1;
        break;
    }
  }

  // Manual marks win (latest per objective).
  const latest = new Map<string, ManualMark>();
  for (const m of marks) {
    const prev = latest.get(m.objective);
    if (!prev || m.at >= prev.at) latest.set(m.objective, m);
  }
  for (const m of latest.values()) {
    if (g.objective.has(m.objective) && m.mark === "done") credits.set(m.objective, { source: "manual", confidence: "manual", evidence: "Marked done by you.", at: m.at });
  }

  // Hard requirements of anything done (inferred or confirmed by you) are done too.
  const closure = [...credits.keys()];
  while (closure.length) {
    const id = closure.pop()!;
    const o = g.objective.get(id);
    if (!o) continue;
    for (const r of o.requires) {
      if (!credits.has(r)) {
        credits.set(r, { source: "requirement", confidence: "inferred", evidence: `Required for “${o.title}”, which is done.`, at: null });
        closure.push(r);
      }
    }
  }

  // "Not done" and "skipped" override any inference.
  const skipped = new Set<string>();
  for (const m of latest.values()) {
    if (!g.objective.has(m.objective) || m.mark === "done") continue;
    credits.delete(m.objective);
    if (m.mark === "skipped") skipped.add(m.objective);
  }

  const partOpen = Object.fromEntries(g.dataset.parts.map((p) => [p.id, partOpenNow(p.id)])) as Record<PartId, boolean>;
  const objectives = new Map<string, ObjectiveProgress>();
  for (const o of g.dataset.objectives) {
    const c = credits.get(o.id);
    const choice = latest.get(o.id)?.choice;
    if (c) {
      objectives.set(o.id, { id: o.id, status: "done", confidence: c.confidence, source: c.source, evidence: c.evidence, at: c.at, choice });
      continue;
    }
    if (skipped.has(o.id)) {
      objectives.set(o.id, { id: o.id, status: "skipped", confidence: "manual", source: "manual", evidence: "Skipped by you.", at: latest.get(o.id)!.at });
      continue;
    }
    const zone = g.zone.get(o.zone)!;
    const zoneOpen = visited.has(zone.id) || (zone.opensAfter ?? []).every((x) => credits.has(x));
    const available = partOpen[o.part] && zoneOpen && o.requires.every((r) => credits.has(r));
    objectives.set(o.id, { id: o.id, status: available ? "available" : "locked", confidence: null, source: null, evidence: null, at: null });
  }

  return {
    objectives,
    partOpen,
    visited,
    currentZone: current,
    currentAreaLevel,
    level,
    deaths,
    unknownAreas: [...unknown],
    unattributedGrants: unattributed,
    ascended,
  };
}

/**
 * Which objective a passive-point grant in `zone` belongs to, among the
 * not-yet-credited objectives whose detection lists the zone. Ranked:
 * 1. requirements done and the objective's own zone visited;
 * 2. the objective's zone and its requirements' zones visited (the player has
 *    at least been where the work happens);
 * 3. its part is open.
 * Ties go to dataset order. No candidate → the grant stays unattributed.
 */
function attributeGrant(
  g: CampaignGraph,
  zone: string | null,
  credits: Map<string, Credit>,
  partOpen: (p: PartId) => boolean,
  visited: Set<string>,
): string | null {
  if (!zone) return null;
  const candidates = g.dataset.objectives.filter(
    (o) => o.detection?.kind === "passive-points" && o.detection.zones.includes(zone) && !credits.has(o.id) && partOpen(o.part),
  );
  const zoneSeen = (id: string) => visited.has(g.objective.get(id)?.zone ?? "");
  const tier = (o: (typeof candidates)[number]) => {
    if (o.requires.every((r) => credits.has(r)) && zoneSeen(o.id)) return 0;
    if (zoneSeen(o.id) && o.requires.every(zoneSeen)) return 1;
    return 2;
  };
  let best: { id: string; tier: number } | null = null;
  for (const o of candidates) {
    const t = tier(o);
    if (!best || t < best.tier) best = { id: o.id, tier: t };
  }
  return best?.id ?? null;
}
