/**
 * CampaignRecommendationEngine (pure). From the dataset graph, one character's
 * derived progress and the chosen mode, picks one primary objective, the other
 * things worth doing at the same destination, a few alternatives, and warnings.
 *
 * - Only `available` objectives are candidates (prerequisites met, part and
 *   zone open) — a locked objective is never recommended.
 * - Score = what the objective is worth in this mode − travel cost (logical
 *   steps) + being already there − unmet community route order.
 * - Stability: the previous primary is kept while it is still available and
 *   either close in score or the player is at its destination.
 */
import type { CampaignObjective, CampaignReward, CampaignZone, ObjectiveCategory, PartId } from "../data/types";
import type { CampaignGraph } from "./graph";
import type { CampaignProgress } from "./progress";
import { describeStep, travelFrom, type TravelPlan } from "./travel";

export type CampaignMode = "full" | "fast" | "power" | "custom";

export interface ModeSettings {
  mode: CampaignMode;
  /** Custom mode: categories the player cares about (progression is always on). */
  categories: ObjectiveCategory[];
  /** Objectives the player pinned to the top. */
  pinned: string[];
  /** Power Leveling: warn when the character is this many levels below the next main zone. */
  levelGap: number;
}

export const DEFAULT_SETTINGS: ModeSettings = {
  mode: "full",
  categories: ["passive", "spirit", "resistance", "life-mana", "charm", "choice", "ascendancy", "unlock"],
  pinned: [],
  levelGap: 3,
};

/** What each category is worth per mode (0 = not pursued). */
const WEIGHTS: Record<Exclude<CampaignMode, "custom">, Record<ObjectiveCategory, number>> = {
  full: { progression: 50, passive: 45, spirit: 45, ascendancy: 50, resistance: 35, charm: 35, "life-mana": 30, choice: 25, unlock: 15, "optional-boss": 5, "quest-item": 0 },
  fast: { progression: 60, passive: 30, spirit: 30, ascendancy: 45, resistance: 12, charm: 12, "life-mana": 10, choice: 5, unlock: 0, "optional-boss": 0, "quest-item": 0 },
  power: { progression: 50, passive: 45, spirit: 45, ascendancy: 55, resistance: 35, charm: 30, "life-mana": 35, choice: 25, unlock: 10, "optional-boss": 15, "quest-item": 0 },
};
/** Penalty per logical travel step. */
const TRAVEL_PENALTY: Record<CampaignMode, number> = { full: 6, fast: 12, power: 6, custom: 6 };
/** Fast mode doesn't send you for optional content worth less than this. */
const FAST_MIN_OPTIONAL_VALUE = 30;
const KEEP_MARGIN = 12;

export type Importance = "critical" | "high" | "medium" | "low";

export interface RecommendedObjective {
  objective: CampaignObjective;
  zone: CampaignZone;
  turnIn: CampaignZone | null;
  score: number;
  importance: Importance;
  rewards: CampaignReward[];
  /** Logical travel steps from the current zone (empty = you are there). */
  travel: string[];
  travelCost: number | null;
  /** Why this was chosen (plain language, most important first). */
  reasons: string[];
  /** How completion will be known. */
  detection: { kind: "automatic" | "partly" | "inferred" | "manual"; note: string };
  /** What to do afterwards. */
  after: string;
  /** Items this needs that come from an objective not done yet. */
  missingItems: { name: string; from: CampaignObjective }[];
}

export interface Warning {
  kind: "dataset" | "level" | "items" | "unattributed" | "unknown-area" | "conflict";
  text: string;
}

export interface Recommendation {
  primary: RecommendedObjective | null;
  /** Other available objectives at the primary's destination. */
  alsoHere: RecommendedObjective[];
  /** Next-best alternatives elsewhere. */
  secondary: RecommendedObjective[];
  warnings: Warning[];
  /** One or two sentences: why this one. */
  explanation: string;
  /** Set when the primary differs from the previous one. */
  changed: { from: string; reason: string } | null;
  /** No available objective left in this mode. */
  complete: boolean;
}

export interface RecommendOptions {
  settings: ModeSettings;
  /** Previous primary objective id, for stability. */
  previous?: string | null;
  /** Build-aware score bonuses (engine/build.ts). */
  boosts?: ReadonlyMap<string, { bonus: number; reason: string }>;
}

const PART_ORDER: PartId[] = ["act1", "act2", "act3", "act4", "int1", "int2", "int3"];

export function recommend(g: CampaignGraph, progress: CampaignProgress, opts: RecommendOptions): Recommendation {
  const { settings } = opts;
  const statusOf = (id: string) => progress.objectives.get(id)?.status;
  const done = (id: string) => statusOf(id) === "done";
  const openParts = new Set(PART_ORDER.filter((p) => progress.partOpen[p]));
  const routes = travelFrom(g, progress.currentZone, progress.visited, openParts);
  const furthestPart = PART_ORDER.reduce((acc, p, i) => (progress.partOpen[p] && p.startsWith("act") ? i : acc), 0);

  // A part is closed for progression once a part it gates is open (e.g. Act 4 after the Interludes open).
  // Its leftover main objectives — unless they wait on a later part — are then just their rewards.
  const { value, isProgression } = modeValuer(g, progress, settings);

  // Power Leveling: under-levelled for the current area → nearby optional content is worth more.
  const underLevelled =
    settings.mode === "power" && progress.level != null && progress.currentAreaLevel != null && progress.currentAreaLevel - progress.level >= settings.levelGap;

  const scored: { o: CampaignObjective; score: number; plan: TravelPlan | null; reasons: string[] }[] = [];
  for (const o of g.dataset.objectives) {
    if (statusOf(o.id) !== "available") continue;
    const reasons: string[] = [];
    const v = value(o);
    const progression = isProgression(o);
    if (!progression && v <= 0) continue;
    if (settings.mode === "fast" && !progression && v < FAST_MIN_OPTIONAL_VALUE && !settings.pinned.includes(o.id)) continue;
    let score = v;
    reasons.push(progression ? "Main quest progression." : o.why);
    const plan = routes.planTo(o.zone);
    if (plan) score -= plan.cost * TRAVEL_PENALTY[settings.mode];
    else score -= 40; // reachable only through areas Vaalytics can't route (unknown id or no known connection)
    if (progress.currentZone === o.zone) {
      score += 20;
      reasons.push("You are already there.");
    } else if (plan && plan.cost <= 1) {
      score += 8;
      reasons.push("It's one step away.");
    }
    if (underLevelled && o.kind === "optional" && plan && plan.cost <= 2) {
      score += 15;
      reasons.push("You are under-levelled here; this gives experience on the way.");
    }
    const unmet = (o.recommendedAfter ?? []).filter((r) => !done(r) && statusOf(r) !== "skipped");
    score -= unmet.length * 15;
    // Optional content in an earlier act than where you are now is backtracking.
    const partIdx = PART_ORDER.indexOf(o.part);
    if (o.kind === "optional" && o.part.startsWith("act") && partIdx < furthestPart) {
      score -= settings.mode === "fast" ? 40 : 15;
      reasons.push("It's in an earlier act — going back costs time.");
    }
    const b = opts.boosts?.get(o.id);
    if (b && v > 0) {
      score += b.bonus;
      reasons.push(b.reason);
    }
    if (settings.pinned.includes(o.id)) {
      score += 1000;
      reasons.unshift("You pinned this objective.");
    }
    score -= (g.order.get(o.id) ?? 0) * 0.01; // stable tie-break: dataset order
    scored.push({ o, score, plan, reasons });
  }
  scored.sort((a, b) => b.score - a.score);

  // Stability: keep the previous primary while it is still a reasonable choice.
  let primaryEntry = scored[0] ?? null;
  let changed: Recommendation["changed"] = null;
  if (opts.previous && primaryEntry && opts.previous !== primaryEntry.o.id) {
    const prev = scored.find((s) => s.o.id === opts.previous);
    if (prev && (prev.score >= primaryEntry.score - KEEP_MARGIN || progress.currentZone === prev.o.zone)) {
      primaryEntry = prev;
    } else {
      const old = g.objective.get(opts.previous);
      const st = statusOf(opts.previous);
      const reason =
        st === "done"
          ? `“${old?.title}” is done.`
          : st === "skipped"
            ? `You skipped “${old?.title}”.`
            : st === "locked" || !old
              ? `“${old?.title ?? opts.previous}” isn't available any more.`
              : `“${primaryEntry.o.title}” is now clearly better (${primaryEntry.reasons[1] ?? primaryEntry.reasons[0]})`;
      changed = { from: opts.previous, reason };
    }
  }

  const build = (e: (typeof scored)[number]): RecommendedObjective => buildEntry(g, progress, e.o, e.score, e.plan, e.reasons);
  const primary = primaryEntry ? build(primaryEntry) : null;
  const alsoHere = primaryEntry
    ? scored.filter((s) => s !== primaryEntry && (s.o.zone === primaryEntry!.o.zone || s.o.turnIn === primaryEntry!.o.zone)).map(build)
    : [];
  const hereIds = new Set([primaryEntry?.o.id, ...alsoHere.map((a) => a.objective.id)]);
  const secondary = scored.filter((s) => !hereIds.has(s.o.id)).slice(0, 4).map(build);

  const warnings = collectWarnings(g, progress, settings, primary);
  const explanation = primary
    ? [
        `${primary.objective.kind === "main" ? "Next main-quest step" : "Best value nearby"}: ${primary.objective.title} in ${primary.zone.name}.`,
        primary.reasons.slice(1, 3).join(" "),
        alsoHere.length ? `${alsoHere.length} more thing${alsoHere.length > 1 ? "s" : ""} to do there on the same trip.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "Nothing left to do in this mode for the parts that are open.";
  return { primary, alsoHere, secondary, warnings, explanation, changed, complete: !primary };
}

/**
 * What objectives are worth in a mode, for this progress (shared by the
 * navigator and the route planner).
 */
export function modeValuer(g: CampaignGraph, progress: CampaignProgress, settings: ModeSettings) {
  const statusOf = (id: string) => progress.objectives.get(id)?.status;
  const done = (id: string) => statusOf(id) === "done";
  const partIndex = (p: PartId) => PART_ORDER.indexOf(p);
  const closedParts = new Set(
    g.dataset.parts.filter((q) => progress.partOpen[q.id]).flatMap((q) => q.opensAfter.map((id) => g.objective.get(id)?.part)).filter((p): p is PartId => !!p),
  );
  const isProgression = (o: CampaignObjective) =>
    o.kind === "main" && (!closedParts.has(o.part) || o.requires.some((r) => partIndex(g.objective.get(r)!.part) > partIndex(o.part)));

  const value = (o: CampaignObjective): number => {
    const weightOf = (c: ObjectiveCategory) => {
      if (settings.mode === "custom") return c === "progression" ? WEIGHTS.full.progression : settings.categories.includes(c) ? WEIGHTS.full[c] : 0;
      return WEIGHTS[settings.mode][c];
    };
    const own = (x: CampaignObjective) => Math.max(0, ...(isProgression(x) ? x.categories : x.categories.filter((c) => c !== "progression")).map(weightOf));
    let v = own(o);
    // A quest-item step is worth what the objective it feeds is worth.
    for (const itemId of o.givesItems ?? []) {
      const item = g.item.get(itemId);
      const consumer = item && item.usedBy !== o.id ? g.objective.get(item.usedBy) : undefined;
      if (consumer && !done(consumer.id) && statusOf(consumer.id) !== "skipped") v = Math.max(v, own(consumer) * 0.9);
    }
    return v;
  };
  /** Whether the mode pursues an objective at all. */
  const pursued = (o: CampaignObjective) => {
    if (settings.pinned.includes(o.id) || isProgression(o)) return true;
    const v = value(o);
    return v > 0 && !(settings.mode === "fast" && v < FAST_MIN_OPTIONAL_VALUE);
  };
  return { value, isProgression, pursued };
}

function importanceOf(o: CampaignObjective): Importance {
  if (o.kind === "main") return "critical";
  if (o.categories.some((c) => c === "passive" || c === "spirit" || c === "ascendancy")) return "high";
  if (o.categories.some((c) => c === "resistance" || c === "life-mana" || c === "charm" || c === "choice")) return "medium";
  return "low";
}

/** A quest-item step matters as much as the objective that uses the item. */
export function importanceWithItems(g: CampaignGraph, o: CampaignObjective): Importance {
  const order: Importance[] = ["low", "medium", "high", "critical"];
  let best = importanceOf(o);
  for (const itemId of o.givesItems ?? []) {
    const item = g.item.get(itemId);
    const consumer = item && item.usedBy !== o.id ? g.objective.get(item.usedBy) : undefined;
    if (consumer && order.indexOf(importanceOf(consumer)) > order.indexOf(best)) best = importanceOf(consumer);
  }
  return best;
}

function buildEntry(g: CampaignGraph, progress: CampaignProgress, o: CampaignObjective, score: number, plan: TravelPlan | null, reasons: string[]): RecommendedObjective {
  const zone = g.zone.get(o.zone)!;
  const turnIn = o.turnIn ? g.zone.get(o.turnIn)! : null;
  const rewards = o.rewards.map((r) => g.reward.get(r)!).filter(Boolean);
  const gate = g.dataset.zones.find((z) => z.opensAfter?.includes(o.id));
  const partGate = g.dataset.parts.find((p) => p.opensAfter.includes(o.id));
  const detection: RecommendedObjective["detection"] =
    o.detection?.kind === "passive-points"
      ? { kind: "automatic", note: "Detected automatically when the game logs the passive points you receive." }
      : o.detection?.kind === "ascended"
        ? { kind: "partly", note: "Your first Ascendancy is detected from the class change; a second trial needs your confirmation." }
        : gate || partGate
          ? { kind: "inferred", note: `Marked done when you enter ${gate ? gate.name : g.zone.get(partGate!.town)!.name}, which opens only after it.` }
          : { kind: "manual", note: "The game log doesn't show this — confirm it yourself when it's done." };

  // What comes after: the dataset's hint, else the next main objective this one unlocks.
  const unlocks = g.dataset.objectives.find((x) => x.kind === "main" && x.requires.includes(o.id));
  const after = o.after ?? (unlocks ? `Then: ${unlocks.title} (${g.zone.get(unlocks.zone)!.name}).` : "Then continue with the main quest.");

  const missingItems: RecommendedObjective["missingItems"] = [];
  for (const itemId of o.needsItems ?? []) {
    const item = g.item.get(itemId);
    if (!item || item.from === o.id) continue;
    const from = g.objective.get(item.from)!;
    if (progress.objectives.get(from.id)?.status !== "done") missingItems.push({ name: item.name, from });
  }

  return {
    objective: o,
    zone,
    turnIn,
    score: Math.round(score * 10) / 10,
    importance: importanceWithItems(g, o),
    rewards,
    travel: plan ? plan.steps.map((s) => describeStep(g, s)) : [`Find your way to ${zone.name} (no known route from here).`],
    travelCost: plan?.cost ?? null,
    reasons,
    detection,
    after,
    missingItems,
  };
}

function collectWarnings(g: CampaignGraph, progress: CampaignProgress, settings: ModeSettings, primary: RecommendedObjective | null): Warning[] {
  const w: Warning[] = [];
  if (primary) {
    for (const m of primary.missingItems) w.push({ kind: "items", text: `You need ${m.name} — it comes from “${m.from.title}” (${g.zone.get(m.from.zone)!.name}).` });
    const conflicted = [primary.objective.provenance, ...primary.rewards.map((r) => r.provenance)].find((p) => p.verification === "conflict");
    if (conflicted) w.push({ kind: "conflict", text: `Guides disagree about part of this objective${conflicted.note ? `: ${conflicted.note}` : "."} Check in game.` });
  }
  // Level gap before the next main-quest zone (no grinding advice, just the fact).
  const nextMain = primary?.objective.kind === "main" ? primary : null;
  const zoneLevel = nextMain && nextMain.zone.levels.length ? Math.min(...nextMain.zone.levels) : null;
  if (progress.level != null && zoneLevel != null && zoneLevel - progress.level >= settings.levelGap) {
    w.push({
      kind: "level",
      text: `You are level ${progress.level}; ${nextMain!.zone.name} was level ${zoneLevel}+ in real runs. Optional objectives on the way give experience and rewards.`,
    });
  }
  if (progress.unattributedGrants.length) {
    w.push({ kind: "unattributed", text: `${progress.unattributedGrants.length} passive-point grant(s) couldn't be matched to an objective — mark the objective yourself if you know which it was.` });
  }
  if (progress.unknownAreas.length) {
    w.push({ kind: "unknown-area", text: `Areas not in the 0.5.5 campaign data: ${progress.unknownAreas.slice(0, 4).join(", ")}. The game may have changed since the data was checked.` });
  }
  return w;
}
