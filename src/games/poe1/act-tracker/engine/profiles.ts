/**
 * Guide editor model (pure): your own guide profiles on top of the shipped route.
 *
 * - The built-in profile ("Fast campaign — all passive points") can't be edited: editing starts from a copy, so the
 *   shipped guide is never overwritten. Route OPTIONS (bandits, trials…) are settings, not edits, and stay
 *   changeable for the built-in profile too.
 * - A profile's edits are a small list of changes applied to the resolved route, never a copy of it, so a new
 *   dataset version still applies them; edits whose step no longer exists are reported, not silently dropped.
 *   - hide: the step is hidden from the guide (still in the route; moves can't be hidden — they track progress)
 *   - move: place a step right after another step of the same visit (same area, no move in between)
 *   - custom: your own instruction after a step
 *   - priority: your priority for a step
 * - Profiles are stored in the PoE 1 setting `actTracker.profiles` (≤ 64 KB) and exported / imported as JSON.
 */
import type { CampaignArea } from "@/games/poe1/location-atlas/data/types";
import type { RouteData } from "../data/types";
import type { PrioritisedStep, StepPriority } from "./priorities";
import { type GuideOptions, resolveRoute, type ResolvedStep } from "./route";

export interface CustomStep {
  /** `custom.<n>` — stable, used by marks. */
  id: string;
  /** Inserted right after this step. */
  after: string;
  text: string;
}

export interface GuideEdits {
  hidden: string[];
  moves: { id: string; after: string }[];
  custom: CustomStep[];
  priorities: Record<string, StepPriority>;
}

export interface UserProfile {
  id: string;
  name: string;
  options: GuideOptions;
  edits: GuideEdits;
  /** Route dataset version the edits were made on (exile-leveling commit). */
  routeVersion: string | null;
  createdAt: number;
  updatedAt: number;
}

export const PROFILES_KEY = "actTracker.profiles";
export const BUILT_IN_ID = "fast-all-passives";
export const EMPTY_EDITS: GuideEdits = { hidden: [], moves: [], custom: [], priorities: {} };
export const LIMITS = { profiles: 12, name: 60, customText: 200, customSteps: 200, hidden: 600, moves: 300 };

const PRIORITIES: StepPriority[] = ["CRITICAL", "PERMANENT_POWER", "ASCENDANCY", "IMPORTANT", "BUILD_OPTIONAL", "SKIP"];
const ID = /^[a-z0-9.-]{1,64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

export interface AppliedRoute {
  steps: ResolvedStep[];
  /** Custom step ids (to tell them apart in the UI). */
  custom: Set<string>;
  hidden: Set<string>;
  priorities: Map<string, StepPriority>;
  /** Edits that point at steps not in this route (other options or an older dataset). */
  stale: number;
}

/** The profile's route: options resolved, then the edits applied in order. */
export function applyProfile(
  route: RouteData,
  options: GuideOptions,
  edits: GuideEdits,
  areas: ReadonlyMap<string, CampaignArea>,
): AppliedRoute {
  let steps = resolveRoute(route, options, areas);
  let stale = 0;
  const has = (id: string) => steps.some((s) => s.id === id);

  for (const m of edits.moves) {
    const from = steps.findIndex((s) => s.id === m.id);
    const anchor = steps.findIndex((s) => s.id === m.after);
    if (from < 0 || anchor < 0 || !canMoveAfter(steps, from, anchor)) {
      stale++;
      continue;
    }
    const [step] = steps.splice(from, 1);
    const at = steps.findIndex((s) => s.id === m.after);
    steps.splice(at + 1, 0, step!);
  }

  const custom = new Set<string>();
  for (const c of edits.custom) {
    const at = steps.findIndex((s) => s.id === c.after);
    if (at < 0) {
      stale++;
      continue;
    }
    const anchor = steps[at]!;
    const where = anchor.to ?? anchor.area;
    steps.splice(at + 1, 0, { id: c.id, act: anchor.act, area: where, kind: "other", text: c.text, hints: [], index: 0, to: null });
    custom.add(c.id);
  }
  steps = steps.map((s, index) => ({ ...s, index }));

  const hidden = new Set<string>();
  for (const id of edits.hidden) {
    const s = steps.find((x) => x.id === id);
    if (!s || s.to) stale++;
    else hidden.add(id);
  }
  const priorities = new Map<string, StepPriority>();
  for (const [id, p] of Object.entries(edits.priorities)) {
    if (has(id) || custom.has(id)) priorities.set(id, p);
    else stale++;
  }
  return { steps, custom, hidden, priorities, stale };
}

/** The visit a step belongs to: the run of steps between two moves, as [start, end) indexes. */
export function visitOf(steps: readonly ResolvedStep[], index: number): [number, number] {
  let start = index;
  while (start > 0 && !steps[start - 1]!.to) start--;
  let end = index;
  while (end < steps.length && !steps[end]!.to) end++;
  return [start, end];
}

/**
 * A step can be placed after an anchor in the same visit (or right after arriving: the move into the visit), so
 * the player's position — and progress tracking — never changes. Moves themselves can't be moved.
 */
export function canMoveAfter(steps: readonly ResolvedStep[], from: number, anchor: number): boolean {
  if (from === anchor || steps[from]!.to) return false;
  const [start, end] = visitOf(steps, from);
  return anchor >= start - 1 && anchor >= 0 && anchor < end;
}

/** The edit to move a step one place up or down within its visit, or null when it can't move that way. */
export function moveEdit(steps: readonly ResolvedStep[], index: number, dir: -1 | 1): { id: string; after: string } | null {
  const s = steps[index];
  if (!s || s.to) return null;
  const [start, end] = visitOf(steps, index);
  if (dir === 1) return index + 1 < end ? { id: s.id, after: steps[index + 1]!.id } : null;
  if (index === start || index - 2 < 0) return null;
  return { id: s.id, after: steps[index - 2]!.id };
}

/** Priority after the profile's overrides. */
export function withOverrides(base: readonly PrioritisedStep[], steps: readonly ResolvedStep[], applied: AppliedRoute): PrioritisedStep[] {
  return steps.map((s, k) => {
    const own = applied.priorities.get(s.id);
    if (own) return { priority: own, why: "Your priority (guide editor)." };
    if (applied.custom.has(s.id)) return { priority: "CRITICAL", why: "Your own step." };
    return base[k] ?? { priority: "CRITICAL", why: "" };
  });
}

// ---------------------------------------------------------------- validation, import / export

export function isGuideEdits(v: unknown): v is GuideEdits {
  if (!isObj(v)) return false;
  const { hidden, moves, custom, priorities } = v;
  return (
    Array.isArray(hidden) &&
    hidden.length <= LIMITS.hidden &&
    hidden.every((x) => typeof x === "string" && ID.test(x)) &&
    Array.isArray(moves) &&
    moves.length <= LIMITS.moves &&
    moves.every((m) => isObj(m) && typeof m.id === "string" && ID.test(m.id) && typeof m.after === "string" && ID.test(m.after)) &&
    Array.isArray(custom) &&
    custom.length <= LIMITS.customSteps &&
    custom.every((c) => isObj(c) && typeof c.id === "string" && /^custom\.[0-9a-z]{1,24}$/.test(c.id) && typeof c.after === "string" && ID.test(c.after) && isStr(c.text, LIMITS.customText)) &&
    isObj(priorities) &&
    Object.entries(priorities).every(([k, p]) => ID.test(k) && PRIORITIES.includes(p as StepPriority))
  );
}

function isOptions(v: unknown): v is GuideOptions {
  return (
    isObj(v) &&
    ["kill", "alira", "kraityn", "oak"].includes(v.bandit as string) &&
    typeof v.trials === "boolean" &&
    typeof v.leagueStartExtras === "boolean" &&
    typeof v.library === "boolean"
  );
}

export function isUserProfile(v: unknown): v is UserProfile {
  return (
    isObj(v) &&
    typeof v.id === "string" &&
    /^user\.[0-9a-z]{1,24}$/.test(v.id) &&
    isStr(v.name, LIMITS.name) &&
    isOptions(v.options) &&
    isGuideEdits(v.edits) &&
    (v.routeVersion === null || typeof v.routeVersion === "string") &&
    typeof v.createdAt === "number" &&
    typeof v.updatedAt === "number"
  );
}

/** Stored profiles, keeping only valid ones (at most LIMITS.profiles). */
export function readProfiles(v: unknown): UserProfile[] {
  return Array.isArray(v) ? v.filter(isUserProfile).slice(0, LIMITS.profiles) : [];
}

export const EXPORT_FORMAT = "vaalytics.poe1.act-tracker.guide";

export interface GuideExport {
  format: typeof EXPORT_FORMAT;
  version: 1;
  game: "poe1";
  gameVersion: string;
  profile: Omit<UserProfile, "id" | "createdAt" | "updatedAt">;
}

export function exportProfile(p: UserProfile, gameVersion: string): string {
  const out: GuideExport = { format: EXPORT_FORMAT, version: 1, game: "poe1", gameVersion, profile: { name: p.name, options: p.options, edits: p.edits, routeVersion: p.routeVersion } };
  return JSON.stringify(out, null, 2);
}

export type ImportResult = { ok: true; profile: UserProfile; warnings: string[] } | { ok: false; error: string };

/** Parses an exported guide. Never trusts it: format, game, sizes and every field are checked. */
export function importProfile(text: string, now: number, newId: string, routeVersion: string | null): ImportResult {
  if (text.length > 64 * 1024) return { ok: false, error: "That guide is larger than 64 KB." };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: "That isn't JSON." };
  }
  if (!isObj(v) || v.format !== EXPORT_FORMAT || v.version !== 1) return { ok: false, error: "That isn't a Vaalytics Act Tracker guide." };
  if (v.game !== "poe1") return { ok: false, error: "That guide is for another game." };
  const p = isObj(v.profile) ? v.profile : null;
  const candidate = p && { id: newId, name: p.name, options: p.options, edits: p.edits, routeVersion: p.routeVersion ?? null, createdAt: now, updatedAt: now };
  if (!candidate || !isUserProfile(candidate)) return { ok: false, error: "The guide's contents are invalid or too large." };
  const warnings: string[] = [];
  if (candidate.routeVersion && routeVersion && candidate.routeVersion !== routeVersion)
    warnings.push(`It was made on another route version (${candidate.routeVersion}); edits for steps that changed are ignored and counted.`);
  return { ok: true, profile: candidate, warnings };
}

/** A new id that isn't used yet. */
export function newId(prefix: "user" | "custom", taken: ReadonlySet<string>, seed: number): string {
  let n = seed;
  for (;;) {
    const id = `${prefix}.${n.toString(36)}`;
    if (!taken.has(id)) return id;
    n++;
  }
}
