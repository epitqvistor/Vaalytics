/**
 * Schematic map of one act (pure): every area of the act, every walking connection
 * from the game data, and "ghost" nodes for areas of neighbouring acts it leads to.
 * Placement is a layered layout from the act's entrance — topology, not geography.
 */
import { layeredLayout } from "@/shared/map/layered";
import type { Box } from "@/shared/map/viewport";
import type { CampaignArea } from "./data/types";

export const COL = 210;
export const ROW = 74;
export const NODE_W = 168;
export const NODE_H = 40;
const PAD = 24;
/** Columns per band before the chain turns into the next band (PoE 1 acts are long chains). */
const MAX_PER_BAND = 5;
const BAND_GAP = 56;

export interface MapNode {
  area: CampaignArea;
  /** An area of another act, shown at the edge for orientation. */
  ghost: boolean;
  /** Centre, in content units. */
  cx: number;
  cy: number;
}

export interface MapEdge {
  from: string;
  to: string;
  /** Only `from → to` exists in the game data. */
  oneWay: boolean;
  /** Leads to another act. */
  crossAct: boolean;
}

export interface ActMap {
  act: number;
  /** The entrance used as the first column. */
  root: string;
  nodes: Map<string, MapNode>;
  edges: MapEdge[];
  bounds: Box;
}

/** The act's entrance: the lowest-level area reached from the previous act, else its lowest-level area. */
export function actRoot(act: number, areas: ReadonlyMap<string, CampaignArea>): string | null {
  const own = [...areas.values()].filter((a) => a.act === act);
  const byLevel = (l: CampaignArea[]) => [...l].sort((a, b) => a.level - b.level || a.id.localeCompare(b.id, "en", { numeric: true }))[0];
  const fromPrev = own.filter((a) => a.connections.some((c) => areas.get(c)?.act === act - 1));
  return (byLevel(fromPrev) ?? byLevel(own.filter((a) => a.kind === "area")) ?? byLevel(own))?.id ?? null;
}

export function buildActMap(act: number, areas: ReadonlyMap<string, CampaignArea>): ActMap {
  const own = [...areas.values()].filter((a) => a.act === act).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const ownIds = new Set(own.map((a) => a.id));
  const ghosts = new Map<string, CampaignArea>();
  const edges: MapEdge[] = [];
  const seen = new Set<string>();
  for (const a of own) {
    for (const c of a.connections) {
      const b = areas.get(c);
      if (!b) continue;
      if (!ownIds.has(c)) ghosts.set(c, b);
      const key = [a.id, c].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const back = b.connections.includes(a.id);
      edges.push({ from: a.id, to: c, oneWay: !back, crossAct: !ownIds.has(c) });
    }
  }
  // One-way entries from another act into this one (rare) are drawn too.
  for (const b of areas.values()) {
    if (ownIds.has(b.id)) continue;
    for (const c of b.connections) {
      if (!ownIds.has(c) || seen.has([b.id, c].sort().join("|"))) continue;
      seen.add([b.id, c].sort().join("|"));
      ghosts.set(b.id, b);
      edges.push({ from: b.id, to: c, oneWay: true, crossAct: true });
    }
  }
  const root = actRoot(act, areas) ?? own[0]?.id ?? "";
  const ids = [...own.map((a) => a.id), ...[...ghosts.keys()].sort()];
  const layout = layeredLayout({ nodes: ids, links: edges.map((e) => [e.from, e.to]), root });
  // Snake: wrap the columns into bands, every other band right-to-left, so the
  // chain turns downwards instead of running off to the right.
  const bands = Math.ceil(layout.columns / MAX_PER_BAND);
  const per = Math.ceil(layout.columns / bands);
  const colSize = new Map<number, number>();
  for (const n of layout.nodes.values()) colSize.set(n.depth, (colSize.get(n.depth) ?? 0) + 1);
  // Each band is as tall as its own tallest column.
  const bandRows: number[] = [];
  for (const [d, size] of colSize) bandRows[Math.floor(d / per)] = Math.max(bandRows[Math.floor(d / per)] ?? 1, size);
  const bandTop: number[] = [];
  let y = PAD;
  for (let b = 0; b < bands; b++) {
    bandTop[b] = y;
    y += ((bandRows[b] ?? 1) - 1) * ROW + NODE_H + BAND_GAP;
  }
  const nodes = new Map<string, MapNode>();
  for (const id of ids) {
    const n = layout.nodes.get(id)!;
    const band = Math.floor(n.depth / per);
    const pos = band % 2 === 0 ? n.depth % per : per - 1 - (n.depth % per);
    const centring = ((bandRows[band] ?? 1) - colSize.get(n.depth)!) / 2;
    nodes.set(id, {
      area: areas.get(id)!,
      ghost: !ownIds.has(id),
      cx: PAD + NODE_W / 2 + pos * COL,
      cy: bandTop[band]! + NODE_H / 2 + (n.row + centring) * ROW,
    });
  }
  const width = 2 * PAD + NODE_W + (Math.min(per, layout.columns) - 1) * COL;
  const height = y - BAND_GAP + PAD;
  return { act, root, nodes, edges, bounds: { x: 0, y: 0, width, height } };
}
