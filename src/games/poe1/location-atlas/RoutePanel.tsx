/** Route Intelligence panel: start, goal and waypoint use; the route as steps with where each fact comes from. */
import { Button, Select } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import type { CampaignArea } from "./data/types";
import { ROUTE_TARGETS, WAYPOINT_MODES, type RoutePlan, type RouteTarget, type WaypointMode } from "./routes";
import { ConfidenceBadge, SectionLabel } from "./ui";

export interface RouteOptions {
  /** Start; null = where you are (follows you as you play). */
  from: string | null;
  /** Destination for the `area` target. */
  to: string | null;
  target: RouteTarget;
  waypoints: WaypointMode;
}

export function RoutePanel({
  options,
  plan,
  areas,
  here,
  selected,
  onChange,
  onClose,
  onSelect,
}: {
  options: RouteOptions;
  plan: RoutePlan;
  areas: ReadonlyMap<string, CampaignArea>;
  here: string | null;
  selected: CampaignArea | null;
  onChange: (o: RouteOptions) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const name = (id: string | null) => (id ? (areas.get(id)?.name ?? id) : "—");
  const fromHere = options.from === null;
  return (
    <section aria-label="Route" className="mb-5 rounded-lg border border-line bg-bg-2 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="route" size={14} className="text-accent" />
        <h2 className="text-sm font-semibold text-fg">Route</h2>
        {plan.ok && (
          <>
            <ConfidenceBadge confidence={plan.confidence} />
            <span className="text-2xs text-fg-subtle tabular-nums">
              {plan.loads === 0 ? "You're there" : `${plan.loads} loading screen${plan.loads === 1 ? "" : "s"}`}
            </span>
          </>
        )}
        <button type="button" aria-label="Close route" title="Close route" onClick={onClose} className="ml-auto text-fg-subtle hover:text-fg">
          <Icon name="close" size={13} />
        </button>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-fg-subtle">From</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-fg">{fromHere ? (here ? `Where you are · ${name(here)}` : "Where you are (not known yet)") : name(options.from)}</span>
          {selected && options.from !== selected.id && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...options, from: selected.id })}>
              From {selected.name}
            </Button>
          )}
          {!fromHere && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...options, from: null })}>
              From where I am
            </Button>
          )}
        </dd>
        <dt className="text-fg-subtle">To</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Select size="sm" label="Route to" hideLabel value={options.target} options={ROUTE_TARGETS} onChange={(target) => onChange({ ...options, target })} />
          {options.target === "area" && <span className="truncate text-fg">{name(options.to)}</span>}
          {options.target === "area" && selected && selected.id !== options.to && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...options, to: selected.id })}>
              To {selected.name}
            </Button>
          )}
        </dd>
        <dt className="text-fg-subtle">Travel</dt>
        <dd>
          <Select size="sm" label="Waypoints" hideLabel value={options.waypoints} options={WAYPOINT_MODES} onChange={(waypoints) => onChange({ ...options, waypoints })} />
        </dd>
      </dl>

      {plan.ok ? (
        <div className="mt-3">
          <SectionLabel>Steps</SectionLabel>
          <ol className="flex flex-col gap-0.5">
            <Stop id={plan.route.nodes[0]!} areas={areas} label="Start" onSelect={onSelect} />
            {plan.route.steps.map((s, i) => (
              <Stop key={`${i}-${s.to}`} id={s.to} areas={areas} kind={s.kind} prevAct={areas.get(s.from)?.act} onSelect={onSelect} />
            ))}
          </ol>
          <ul className="mt-2 flex flex-col gap-0.5 text-2xs text-fg-subtle">
            {plan.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-line bg-bg px-2.5 py-2 text-xs text-fg-muted">{plan.reason}</p>
      )}
    </section>
  );
}

function Stop({
  id,
  areas,
  kind,
  label,
  prevAct,
  onSelect,
}: {
  id: string;
  areas: ReadonlyMap<string, CampaignArea>;
  kind?: "walk" | "waypoint";
  label?: string;
  prevAct?: number;
  onSelect: (id: string) => void;
}) {
  const a = areas.get(id);
  if (!a) return null;
  const how = label ?? (kind === "waypoint" ? "Waypoint to" : "Walk to");
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(id)}
        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-glass-strong"
        title={`Show ${a.name}`}
      >
        <Icon
          name={kind === "waypoint" ? "waypoint" : label ? "journal" : "arrowRight"}
          size={12}
          className={cn("shrink-0", kind === "waypoint" ? "text-info" : "text-fg-subtle")}
        />
        <span className="w-20 shrink-0 text-fg-subtle">{how}</span>
        <span className="min-w-0 truncate text-fg">{a.name}</span>
        {prevAct !== undefined && prevAct !== a.act && <span className="shrink-0 text-2xs text-accent">Act {a.act}</span>}
        <span className="ml-auto shrink-0 text-2xs text-fg-subtle tabular-nums">lvl {a.level}</span>
      </button>
    </li>
  );
}
