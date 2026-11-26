/** Small presentational pieces shared by the overlay and the guide page. */
import { Badge, type BadgeTone } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";
import type { StepKind } from "./data/types";
import type { Position, StepProgress } from "./engine/progress";
import { PRIORITY_LABEL, type PrioritisedStep, type StepPriority } from "./engine/priorities";
import type { WayPlan } from "./engine/recovery";
import type { ResolvedStep } from "./engine/route";
import type { StepTag } from "./engine/view";

export const KIND_ICON: Record<StepKind, IconName> = {
  enter: "chevronRight",
  waypoint: "waypoint",
  logout: "town",
  portal: "town",
  "hand-in": "check",
  kill: "boss",
  "quest-item": "gem",
  trial: "star",
  labyrinth: "star",
  "get-waypoint": "waypoint",
  crafting: "crafting",
  other: "info",
};

/** How a step is known to be behind you. */
export const EVIDENCE_LABEL: Record<NonNullable<StepProgress["evidence"]>, string> = {
  "area-entered": "Area entered (Client.txt)",
  confirmed: "Confirmed by you",
  skipped: "Skipped by you",
  passed: "Passed — not confirmed",
};

export function PositionBadge({ position, name }: { position: Position; name: (id: string) => string }) {
  const map: Record<Position["kind"], [BadgeTone, string]> = {
    none: ["neutral", "No area yet"],
    "on-route": ["success", "On route"],
    "town-visit": ["info", "Town visit"],
    "off-route": ["warning", "Off route"],
    outside: ["neutral", "Outside the campaign"],
  };
  const [tone, label] = map[position.kind];
  return (
    <Badge tone={tone} dot>
      <span title={position.kind === "none" ? undefined : name(position.areaId)}>{label}</span>
    </Badge>
  );
}

const TAG_TONE: Record<StepTag, string> = {
  CURRENT: "text-accent",
  NEXT: "text-fg",
  UPCOMING: "text-fg-subtle",
};

export function StepTagLabel({ tag }: { tag: StepTag }) {
  return <span className={cn("w-[74px] shrink-0 text-2xs font-semibold", TAG_TONE[tag])}>[{tag}]</span>;
}

/** Marker for the priorities worth noticing while playing (critical steps carry none). */
const PRIORITY_MARK: Partial<Record<StepPriority, { label: string; cls: string }>> = {
  PERMANENT_POWER: { label: "PASSIVE", cls: "border-accent/40 text-accent-2" },
  ASCENDANCY: { label: "ASC", cls: "border-info/40 text-info" },
  IMPORTANT: { label: "!", cls: "border-warning/40 text-warning" },
  BUILD_OPTIONAL: { label: "OPT", cls: "border-line-strong text-fg-subtle" },
  SKIP: { label: "SKIP", cls: "border-line text-fg-disabled" },
};

export function StepText({ step, muted, priority }: { step: ResolvedStep; muted?: boolean; priority?: PrioritisedStep }) {
  const mark = priority ? PRIORITY_MARK[priority.priority] : undefined;
  return (
    <span className={cn("flex min-w-0 items-start gap-1.5", muted ? "text-fg-muted" : "text-fg")}>
      <Icon name={KIND_ICON[step.kind]} size={13} className="mt-[3px] shrink-0 text-fg-subtle" />
      <span className="min-w-0">
        {step.text}
        {mark && (
          <span title={`${PRIORITY_LABEL[priority!.priority]}: ${priority!.why}`} className={cn("ml-1.5 inline-block rounded-xs border px-1 align-[1px] text-2xs leading-3.5 font-medium", mark.cls)}>
            {mark.label}
          </span>
        )}
      </span>
    </span>
  );
}

/** "Way back: A → B → C · 3 loading screens" (Location Atlas planner). */
export function WayLine({ way, name }: { way: WayPlan; name: (id: string) => string }) {
  return (
    <span title={way.confidence === "estimated" ? "Waypoints count as unlocked once you've entered their area — the log can't see the click." : undefined}>
      Way back: {way.viaWaypoint && way.path.length > 0 && !way.path.slice(1).length ? "waypoint to " : ""}
      {way.path.map((id) => name(id)).join(" → ")} · {way.loads} loading screen{way.loads === 1 ? "" : "s"}
      {way.viaWaypoint ? " (waypoint)" : ""}
    </span>
  );
}

/** Minimap direction hint (0° = up, clockwise), community source. */
export function HintLine({ text, direction }: { text: string; direction?: number }) {
  return (
    <li className="flex items-start gap-1.5 text-2xs text-fg-muted">
      {direction !== undefined ? (
        <span className="mt-[2px] inline-flex shrink-0" style={{ transform: `rotate(${direction}deg)` }} aria-label={`direction ${direction}°`}>
          <Icon name="arrowUp" size={11} className="text-warning" />
        </span>
      ) : (
        <Icon name="info" size={11} className="mt-[2px] shrink-0 text-fg-subtle" />
      )}
      <span>{text}</span>
    </li>
  );
}

/** A readable name for a non-campaign area id from the log (hideout, map, Labyrinth…). */
export function outsideName(id: string, logged: string | null): string {
  if (logged) return logged;
  if (/hideout/i.test(id)) return "your hideout";
  if (/labyrinth|airlock/i.test(id)) return "the Labyrinth";
  if (/^Map/.test(id)) return "a map";
  return id;
}
