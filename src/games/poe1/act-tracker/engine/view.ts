/**
 * What the overlay shows (pure): the current objective (the steps in this area up to the move to the next
 * location), the next few steps with their labels, and act / campaign progress.
 */
import type { ResolvedStep } from "./route";
import type { RouteProgress } from "./progress";

export type StepTag = "CURRENT" | "NEXT" | "UPCOMING";

export interface Objective {
  /** Area the objective is in (where the current step is done). */
  area: string;
  act: number;
  /** Current step first, then the rest of this visit, ending with the move on (if any). */
  steps: ResolvedStep[];
  /** Where the route goes after this visit. */
  nextLocation: string | null;
  /** The step after the move on (first thing in the next location). */
}

export interface TaggedStep {
  step: ResolvedStep;
  tag: StepTag;
}

export interface ActProgress {
  act: number;
  done: number;
  total: number;
}

/** Which steps the guide shows ("important only" hides some); moves are always shown so the path stays whole. */
export type StepFilter = (s: ResolvedStep) => boolean;
const all: StepFilter = () => true;

/** Steps grouped as one visit: from the cursor through the first step that leads somewhere (max `limit`). */
export function currentObjective(steps: readonly ResolvedStep[], progress: RouteProgress, limit = 6, show: StepFilter = all): Objective | null {
  const group: ResolvedStep[] = [];
  for (let k = progress.cursor; k < steps.length && group.length < limit; k++) {
    const s = steps[k]!;
    if (s.to || show(s)) group.push(s);
    if (s.to) break;
  }
  const first = group[0];
  if (!first) return null;
  const move = group[group.length - 1]?.to ?? null;
  return { area: first.area, act: first.act, steps: group, nextLocation: move };
}

/** The next `count` shown steps from the cursor, tagged CURRENT / NEXT / UPCOMING. */
export function nextSteps(steps: readonly ResolvedStep[], progress: RouteProgress, count = 5, show: StepFilter = all): TaggedStep[] {
  const out: ResolvedStep[] = [];
  for (let k = progress.cursor; k < steps.length && out.length < count; k++) if (steps[k]!.to || show(steps[k]!)) out.push(steps[k]!);
  return out.map((step, k) => ({ step, tag: k === 0 ? "CURRENT" : k === 1 ? "NEXT" : "UPCOMING" }));
}

export interface TownVisit {
  town: string;
  /** Hand-ins the route does on this town visit (one trip for all of them). */
  handIns: ResolvedStep[];
}

/** When the current visit ends in a town: what the route hands in there before leaving again. */
export function townVisitAfter(steps: readonly ResolvedStep[], objective: Objective | null, isTown: (id: string) => boolean, show: StepFilter = all): TownVisit | null {
  const move = objective?.steps[objective.steps.length - 1];
  if (!move?.to || !isTown(move.to)) return null;
  const handIns: ResolvedStep[] = [];
  for (let k = move.index + 1; k < steps.length; k++) {
    const s = steps[k]!;
    if (s.kind === "hand-in" && show(s)) handIns.push(s);
    if (s.to) break;
  }
  return { town: move.to, handIns };
}

/** Steps behind the cursor in the current act (reopened ones not counted). */
export function actProgress(steps: readonly ResolvedStep[], progress: RouteProgress): ActProgress | null {
  const act = (steps[progress.cursor] ?? steps[steps.length - 1])?.act;
  if (act === undefined) return null;
  let done = 0;
  let total = 0;
  steps.forEach((s, k) => {
    if (s.act !== act) return;
    total++;
    if (k < progress.cursor && !progress.steps[k]?.reopened) done++;
  });
  return { act, done, total };
}

/** Steps the route moved past that the player reopened, or that hold a quest hand-in and were only passed. */
export function stepsToCheck(steps: readonly ResolvedStep[], progress: RouteProgress): ResolvedStep[] {
  return steps.filter((s, k) => {
    const p = progress.steps[k];
    if (!p || k >= progress.cursor) return false;
    return p.reopened || (p.status === "passed" && s.kind === "hand-in");
  });
}
