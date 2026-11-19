/** Interactive schematic map of one act: areas as nodes, game connections as edges, toggleable layers. */
import { memo, useMemo } from "react";
import { ICONS, type IconName } from "@/shared/icons/icons";
import { MapViewport } from "@/shared/map/MapViewport";
import type { Route } from "@/shared/map/route";
import { cn } from "@/shared/utilities/cn";
import { buildActMap, NODE_H, NODE_W, type ActMap, type MapNode } from "./actMap";
import type { CampaignArea } from "./data/types";

export type MapLayer = "labels" | "levels" | "waypoints" | "bosses" | "hints" | "visited";
export const MAP_LAYERS: { id: MapLayer; label: string }[] = [
  { id: "labels", label: "Labels" },
  { id: "levels", label: "Levels" },
  { id: "waypoints", label: "Waypoints" },
  { id: "bosses", label: "Bosses" },
  { id: "hints", label: "Hints" },
  { id: "visited", label: "Visited" },
];
export const DEFAULT_LAYERS: MapLayer[] = ["labels", "levels", "waypoints", "bosses", "hints", "visited"];

export function ActMapView({
  act,
  areas,
  selected,
  current,
  visited,
  hintCount,
  layers,
  route,
  onLayers,
  onSelect,
}: {
  act: number;
  areas: ReadonlyMap<string, CampaignArea>;
  selected: string | null;
  current: string | null;
  visited: ReadonlySet<string>;
  hintCount: ReadonlyMap<string, number>;
  layers: MapLayer[];
  /** A planned route to draw over the map (only its steps inside this act show). */
  route?: Route | null;
  onLayers: (l: MapLayer[]) => void;
  onSelect: (id: string) => void;
}) {
  const map = useMemo(() => buildActMap(act, areas), [act, areas]);
  const on = new Set(layers);
  const order = useMemo(() => {
    const m = new Map<string, number>();
    route?.nodes.forEach((n, i) => !m.has(n) && m.set(n, i));
    return m;
  }, [route]);

  return (
    <MapViewport
      content={map.bounds}
      fitKey={`act-${act}`}
      label={`Act ${act} map: areas and their connections`}
      overlay={
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto flex flex-wrap gap-1 rounded-md border border-line bg-bg-2/90 p-1">
            {MAP_LAYERS.map((l) => (
              <button
                key={l.id}
                type="button"
                aria-pressed={on.has(l.id)}
                onClick={() => onLayers(on.has(l.id) ? layers.filter((x) => x !== l.id) : [...layers, l.id])}
                className={cn(
                  "h-6 rounded px-2 text-2xs transition-colors",
                  on.has(l.id) ? "bg-accent-soft text-accent" : "text-fg-subtle hover:text-fg",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="rounded-md border border-line bg-bg-2/90 px-2 py-1 text-2xs text-fg-subtle">
            Schematic: connections from the game files, not distances or directions
          </p>
        </div>
      }
    >
      <Edges map={map} />
      {route && <RouteLayer map={map} route={route} />}
      {[...map.nodes.values()].map((n) => (
        <Node
          key={n.area.id}
          node={n}
          step={order.get(n.area.id)}
          selected={n.area.id === selected}
          current={n.area.id === current}
          visited={on.has("visited") && visited.has(n.area.id)}
          hints={on.has("hints") ? (hintCount.get(n.area.id) ?? 0) : 0}
          labels={on.has("labels")}
          levels={on.has("levels")}
          waypoints={on.has("waypoints")}
          bosses={on.has("bosses")}
          onSelect={onSelect}
        />
      ))}
    </MapViewport>
  );
}

/** The route over the map: walking steps along their edges, waypoint jumps as dashed lines. */
const RouteLayer = memo(function RouteLayer({ map, route }: { map: ActMap; route: Route }) {
  return (
    <g pointerEvents="none">
      {route.steps.map((s, i) => {
        const a = map.nodes.get(s.from);
        const b = map.nodes.get(s.to);
        if (!a || !b) return null;
        const jump = s.kind === "waypoint";
        return (
          <path
            key={`${i}-${s.from}-${s.to}`}
            d={jump ? `M${a.cx} ${a.cy} L${b.cx} ${b.cy}` : edgePath(a, b)}
            fill="none"
            stroke={jump ? "var(--color-info)" : "var(--color-accent)"}
            strokeWidth={jump ? 2 : 3.5}
            strokeOpacity={0.85}
            strokeDasharray={jump ? "6 5" : undefined}
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
});

const Edges = memo(function Edges({ map }: { map: ActMap }) {
  return (
    <g>
      <defs>
        <marker id="atlas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--color-fg-subtle)" />
        </marker>
      </defs>
      {map.edges.map((e) => {
        const a = map.nodes.get(e.from)!;
        const b = map.nodes.get(e.to)!;
        return (
          <path
            key={`${e.from}-${e.to}`}
            d={edgePath(a, b)}
            fill="none"
            stroke={e.crossAct ? "var(--color-line-strong)" : "var(--color-fg-disabled)"}
            strokeWidth={1.5}
            strokeDasharray={e.crossAct ? "5 4" : undefined}
            markerEnd={e.oneWay ? "url(#atlas-arrow)" : undefined}
          >
            <title>{`${a.area.name} ${e.oneWay ? "→" : "↔"} ${b.area.name}${e.oneWay ? " (one way)" : ""}`}</title>
          </path>
        );
      })}
    </g>
  );
});

/** Horizontal S-curve between node sides; vertical neighbours connect top/bottom. */
function edgePath(a: MapNode, b: MapNode): string {
  if (Math.abs(a.cx - b.cx) < 1) {
    const [top, bottom] = a.cy < b.cy ? [a, b] : [b, a];
    const y1 = top.cy + NODE_H / 2;
    const y2 = bottom.cy - NODE_H / 2;
    const path = `M${top.cx} ${y1} L${bottom.cx} ${y2}`;
    return a === top ? path : `M${bottom.cx} ${y2} L${top.cx} ${y1}`;
  }
  const dir = b.cx > a.cx ? 1 : -1;
  const x1 = a.cx + (dir * NODE_W) / 2;
  const x2 = b.cx - (dir * NODE_W) / 2;
  const mid = (x1 + x2) / 2;
  return `M${x1} ${a.cy} C${mid} ${a.cy} ${mid} ${b.cy} ${x2} ${b.cy}`;
}

function Glyph({ name, x, y, color, size = 12 }: { name: IconName; x: number; y: number; color: string; size?: number }) {
  const s = size / 20;
  return (
    <path
      d={ICONS[name]}
      transform={`translate(${x} ${y}) scale(${s})`}
      fill="none"
      stroke={color}
      strokeWidth={1.5 / s / 1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

const Node = memo(function Node({
  node,
  step,
  selected,
  current,
  visited,
  hints,
  labels,
  levels,
  waypoints,
  bosses,
  onSelect,
}: {
  node: MapNode;
  /** Position on the planned route (0 = start). */
  step?: number;
  selected: boolean;
  current: boolean;
  visited: boolean;
  hints: number;
  labels: boolean;
  levels: boolean;
  waypoints: boolean;
  bosses: boolean;
  onSelect: (id: string) => void;
}) {
  const { area, ghost, cx, cy } = node;
  const x = cx - NODE_W / 2;
  const y = cy - NODE_H / 2;
  const name = ghost ? `Act ${area.act} · ${area.name}` : area.name;
  const short = name.length > 24 ? `${name.slice(0, 23)}…` : name;
  const hasBoss = area.kind === "area" && ((area.bossNames?.length ?? 0) > 0 || area.bossCount > 0);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${name}${current ? ", you are here" : ""}${step === 0 ? ", route start" : step ? `, route step ${step}` : ""}`}
      className="cursor-pointer outline-none"
      onClick={() => onSelect(area.id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(area.id)}
      opacity={ghost ? 0.55 : 1}
    >
      <title>
        {`${name} — area level ${area.level}${area.waypoint ? ", waypoint" : ""}${hasBoss ? ", boss" : ""}${hints ? `, ${hints} hint(s)` : ""}`}
      </title>
      {current && <rect x={x - 5} y={y - 5} width={NODE_W + 10} height={NODE_H + 10} rx={11} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 3" />}
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={8}
        fill={selected ? "var(--color-elevated-2)" : area.kind === "town" ? "var(--color-elevated)" : "var(--color-bg-2)"}
        stroke={selected || step !== undefined ? "var(--color-accent)" : current ? "var(--color-accent-2)" : "var(--color-line-strong)"}
        strokeWidth={selected ? 2 : step !== undefined ? 1.5 : 1}
        strokeDasharray={ghost ? "4 3" : undefined}
      />
      {area.kind === "town" && <Glyph name="town" x={x + 8} y={cy - 6} color="var(--color-fg-muted)" />}
      {labels ? (
        <text x={x + (area.kind === "town" ? 24 : 10)} y={cy + 4} fontSize={12} fill={visited || current || selected ? "var(--color-fg)" : "var(--color-fg-muted)"} className="font-medium">
          {short}
        </text>
      ) : null}
      {levels && (
        <text x={x + NODE_W - 8} y={y + 11} fontSize={9} textAnchor="end" fill="var(--color-fg-subtle)" className="tabular-nums">
          {area.level}
        </text>
      )}
      <g>
        {waypoints && area.waypoint && <Glyph name="waypoint" x={x + NODE_W - 40} y={y + NODE_H - 15} color="var(--color-info)" size={11} />}
        {bosses && hasBoss && <Glyph name="boss" x={x + NODE_W - 27} y={y + NODE_H - 15} color="var(--color-danger)" size={11} />}
        {visited && <Glyph name="check" x={x + NODE_W - 15} y={y + NODE_H - 15} color="var(--color-fg-subtle)" size={11} />}
      </g>
      {step !== undefined && step > 0 && (
        <g>
          <circle cx={x + NODE_W} cy={y} r={8} fill="var(--color-accent)" />
          <text x={x + NODE_W} y={y + 3} fontSize={9} textAnchor="middle" fill="var(--color-on-accent)" className="font-semibold tabular-nums">
            {step}
          </text>
        </g>
      )}
      {hints > 0 && (
        <g>
          <circle cx={x} cy={y} r={8} fill="var(--color-accent-soft)" stroke="var(--color-accent)" strokeWidth={1} />
          <text x={x} y={y + 3} fontSize={9} textAnchor="middle" fill="var(--color-accent)" className="tabular-nums">
            {hints}
          </text>
        </g>
      )}
    </g>
  );
});
