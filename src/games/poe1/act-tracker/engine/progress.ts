/**
 * Route progress (pure): where the player is in the resolved route, from the character's area entries in
 * Client.txt (via the shared campaign hook) and the player's own marks.
 *
 * What the log proves and what it doesn't:
 * - AREA ENTERED is a fact (`Generating level N area "<id>"`). A step that takes you to an area (enter, waypoint,
 *   logout, portal) is detected when that area is entered in the right place of the route.
 * - Kills, quest items, hand-ins and rewards are NOT in the log. When the route moves past such a step it is
 *   `passed` — an inference, labelled as one — never `done`. Only the player's mark makes it done (or skipped).
 *
 * Matching an area entry (A, coming from P) against the route, from the cursor (the first step not yet behind):
 * 1. The next step that leads somewhere leads to A → follow it.
 * 2. A is a town → a town visit (selling, a portal); the guide stays where it is.
 * 2b. A is the area of the current step (back after a town visit) → nothing moves.
 * 3. A later step, within this act and the next, makes exactly this move (walks into A from P, or takes a
 *    waypoint / portal / logout to A from a town or hideout) → the player took a shortcut or a different order;
 *    the steps skipped on the way are `passed`.
 * 4. Same, from another area, and A was never entered before in this run → progress by another path.
 * 5. A is in a later act than the window AND the next other campaign area entered is in that act or later → the log
 *    starts mid-campaign (or a long gap); jump to it. A single stray entry far ahead (a login segment attributed
 *    to this character, e.g. Karui Shores before a level-2 character's Twilight Strand) never moves the guide.
 * 6. Otherwise (backtracking, an optional area) → off route; the guide is not reset.
 * Marks are applied in time order with the area entries: a "done"/"skipped" mark moves the cursor past that step.
 */
import type { CampaignEventRow, CampaignMark } from "@/core/ipc/commands";
import type { CampaignArea } from "@/games/poe1/location-atlas/data/types";
import type { RouteData } from "../data/types";
import { type ResolvedStep, townOf } from "./route";

/** Prefix of every Act Tracker mark id in the shared `campaign_marks` table. */
export const STEP_MARK_PREFIX = "act.step.";
export const stepMarkId = (stepId: string) => `${STEP_MARK_PREFIX}${stepId}`;

export type StepEvidence =
  /** The area this step leads to was entered here (Client.txt). */
  | "area-entered"
  /** The player marked it done. */
  | "confirmed"
  /** The player skipped it. */
  | "skipped"
  /** The route moved past it; not confirmed. */
  | "passed";

export type StepStatus = "done" | "skipped" | "passed" | "current" | "pending";

export interface StepProgress {
  status: StepStatus;
  evidence: StepEvidence | null;
  /** When the evidence was recorded (unix s). */
  at: number | null;
  /** The player marked it "not done" after it was passed — a step to go back to. */
  reopened: boolean;
}

export type Position =
  | { kind: "none" }
  | { kind: "on-route"; areaId: string; at: number }
  | { kind: "town-visit"; areaId: string; at: number }
  | { kind: "off-route"; areaId: string; at: number }
  /** `areaName`: the name the log gave (e.g. a hideout), when there was one. */
  | { kind: "outside"; areaId: string; areaName: string | null; at: number };

export interface RouteProgress {
  /** Index of the current step (= steps.length when the route is finished). */
  cursor: number;
  steps: StepProgress[];
  position: Position;
  /** Campaign areas entered (this character). */
  visited: Set<string>;
  doneCount: number;
  remainingCount: number;
  /** 0–1 share of steps behind the cursor. */
  fraction: number;
}

interface Input {
  steps: readonly ResolvedStep[];
  events: readonly CampaignEventRow[];
  marks: readonly CampaignMark[];
  areas: ReadonlyMap<string, CampaignArea>;
  route: RouteData;
}

const isCampaignArea = (id: string, i: Input) => i.areas.has(id) || id in i.route.extraAreas;
const isTown = (id: string, i: Input) => townOf(id, i.areas, i.route) === id;
const actOf = (id: string, i: Input) => i.areas.get(id)?.act ?? i.route.extraAreas[id]?.act ?? null;

export function deriveProgress(input: Input): RouteProgress {
  const { steps } = input;
  const state: StepProgress[] = steps.map(() => ({ status: "pending", evidence: null, at: null, reopened: false }));
  const index = new Map(steps.map((s, k) => [s.id, k]));
  let cursor = 0;
  let position: Position = { kind: "none" };
  let prev: string | null = null;
  const visited = new Set<string>();

  /** Moves the cursor to `to` (exclusive); steps on the way without evidence become passed. */
  const advance = (to: number, at: number) => {
    for (let k = cursor; k < to; k++) if (!state[k]!.evidence) state[k] = { ...state[k]!, evidence: "passed", at };
    cursor = Math.max(cursor, to);
  };

  // Marks and area entries in time order (marks after entries at the same second).
  type Item = { at: number; zone?: CampaignEventRow; mark?: CampaignMark };
  const items: Item[] = [
    ...input.events.filter((e) => e.kind === "zone" && e.areaId).map((zone): Item => ({ at: zone.at, zone })),
    ...input.marks.filter((m) => m.objectiveId.startsWith(STEP_MARK_PREFIX)).map((mark): Item => ({ at: mark.at, mark })),
  ].sort((a, b) => a.at - b.at || (a.zone ? 0 : 1) - (b.zone ? 0 : 1));

  // Act of the next entry into a DIFFERENT campaign area after each item (rule 5: re-entering the same far-ahead
  // area, e.g. logging into another character standing in Karui Shores twice, confirms nothing).
  const nextAct: (number | null)[] = new Array(items.length).fill(null);
  let next1: { area: string; act: number | null } | null = null; // nearest later campaign entry
  let next2: { area: string; act: number | null } | null = null; // nearest later entry into another area than next1
  for (let k = items.length - 1; k >= 0; k--) {
    const z = items[k]!.zone;
    if (!z?.areaId || !isCampaignArea(z.areaId, input)) {
      nextAct[k] = next1?.act ?? null;
      continue;
    }
    nextAct[k] = (next1 && next1.area !== z.areaId ? next1.act : next2?.act) ?? null;
    const here = { area: z.areaId, act: actOf(z.areaId, input) };
    if (next1 && next1.area !== here.area) next2 = next1;
    next1 = here;
  }

  for (const [n, item] of items.entries()) {
    if (item.mark) {
      const k = index.get(item.mark.objectiveId.slice(STEP_MARK_PREFIX.length));
      if (k === undefined) continue; // a step of another profile / dataset version
      const m = item.mark.mark;
      if (m === "not-done") state[k] = { status: "pending", evidence: null, at: item.at, reopened: k < cursor };
      else {
        state[k] = { ...state[k]!, evidence: m === "done" ? "confirmed" : "skipped", at: item.at, reopened: false };
        if (k >= cursor) advance(k + 1, item.at);
      }
      continue;
    }
    const a = item.zone!.areaId!;
    const at = item.at;
    if (!isCampaignArea(a, input)) {
      position = { kind: "outside", areaId: a, areaName: item.zone!.areaName, at };
      prev = a;
      continue;
    }
    const firstVisit = !visited.has(a);
    visited.add(a);
    const j = matchEntry(input, cursor, a, prev, firstVisit, nextAct[n] ?? null);
    if (j !== null) {
      advance(j, at);
      state[j] = { ...state[j]!, evidence: state[j]!.evidence === "confirmed" ? "confirmed" : "area-entered", at };
      cursor = Math.max(cursor, j + 1);
      position = { kind: "on-route", areaId: a, at };
    } else if (cursor < steps.length && steps[cursor]!.area === a) position = { kind: "on-route", areaId: a, at };
    else if (isTown(a, input)) position = { kind: "town-visit", areaId: a, at };
    else position = { kind: "off-route", areaId: a, at };
    prev = a;
  }

  let done = 0;
  for (let k = 0; k < steps.length; k++) {
    const s = state[k]!;
    s.status =
      s.evidence === "confirmed" || s.evidence === "area-entered"
        ? "done"
        : s.evidence === "skipped"
          ? "skipped"
          : s.evidence === "passed"
            ? "passed"
            : k === cursor
              ? "current"
              : "pending";
    if (k < cursor && !s.reopened) done++;
  }
  return {
    cursor,
    steps: state,
    position,
    visited,
    doneCount: done,
    remainingCount: steps.length - done,
    fraction: steps.length ? done / steps.length : 0,
  };
}

/** The route step (index ≥ cursor) that this area entry fulfils, or null. See the rules at the top. */
function matchEntry(i: Input, cursor: number, a: string, prev: string | null, firstVisit: boolean, nextAct: number | null): number | null {
  const { steps } = i;
  // 1. the next step that leads somewhere
  let next = cursor;
  while (next < steps.length && !steps[next]!.to) next++;
  if (next < steps.length && steps[next]!.to === a) return next;
  const act = cursor < steps.length ? steps[cursor]!.act : 11;
  const areaAct = actOf(a, i);
  const farAhead = areaAct !== null && areaAct > act + 1 && nextAct !== null && nextAct >= areaAct;
  // 2. towns never move the guide on their own (unless far ahead, rule 5)
  if (isTown(a, i) && !farAhead) return null;
  // 2b. back in the area the current step is in (e.g. after a town visit): you are where the guide is
  if (cursor < steps.length && steps[cursor]!.area === a) return null;
  // window: this act and the next
  const fromHub = prev === null || isTown(prev, i) || !isCampaignArea(prev, i); // town, hideout, map…
  let weak: number | null = null;
  for (let k = next; k < steps.length && steps[k]!.act <= act + 1; k++) {
    const s = steps[k]!;
    if (s.to !== a) continue;
    // 3. exactly the move the route makes: walking in from the step's area, or a waypoint/portal from town
    if (s.kind === "enter" ? s.area === prev || prev === null : fromHub) return k;
    if (weak === null && firstVisit) weak = k; // 4.
  }
  if (weak !== null) return weak;
  // 5. far ahead: the first step that leads there, if the area belongs to a later act
  if (farAhead) {
    for (let k = next; k < steps.length; k++) if (steps[k]!.to === a) return k;
  }
  return null; // 6.
}
