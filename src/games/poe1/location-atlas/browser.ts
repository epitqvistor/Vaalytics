/** Location browser: preferences and filtering (pure, generated from the dataset — no area is hard-coded). */
import type { JsonValue } from "@/core/ipc/commands";
import type { CampaignArea } from "./data/types";

export const PREFS_KEY = "atlas.prefs";

export type AtlasFilter = "all" | "towns" | "waypoints" | "bosses" | "hints" | "visited" | "favorites" | "recent";
export const FILTERS: { value: AtlasFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "towns", label: "Towns" },
  { value: "waypoints", label: "Waypoints" },
  { value: "bosses", label: "Bosses" },
  { value: "hints", label: "With hints" },
  { value: "visited", label: "Visited" },
  { value: "favorites", label: "Favourites" },
  { value: "recent", label: "Recent" },
];

export interface AtlasPrefs {
  [key: string]: JsonValue;
  act: number;
  /** Area shown; null = none chosen yet. */
  selected: string | null;
  /** Follow the area you are in (from Client.txt); choosing an area by hand turns it off. */
  follow: boolean;
  compact: boolean;
  filter: AtlasFilter;
  favorites: string[];
  /** Most recent first. */
  recent: string[];
  /** Visible map layers. Settings saved before the map existed lack it: read with `?? DEFAULT_LAYERS`. */
  layers: string[];
}

export const DEFAULT_PREFS: AtlasPrefs = { act: 1, selected: null, follow: true, compact: false, filter: "all", favorites: [], recent: [], layers: ["labels", "levels", "waypoints", "bosses", "hints", "visited"] };
export const RECENT_MAX = 12;

const AREA = /^[12]_\d+_[A-Za-z0-9_]+$/;
const ids = (v: unknown) => Array.isArray(v) && v.length <= 200 && v.every((s) => typeof s === "string" && AREA.test(s));

export function isAtlasPrefs(v: unknown): v is AtlasPrefs {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.act === "number" &&
    p.act >= 1 &&
    p.act <= 10 &&
    (p.selected === null || (typeof p.selected === "string" && AREA.test(p.selected))) &&
    typeof p.follow === "boolean" &&
    typeof p.compact === "boolean" &&
    FILTERS.some((f) => f.value === p.filter) &&
    ids(p.favorites) &&
    ids(p.recent) &&
    (p.layers === undefined || (Array.isArray(p.layers) && p.layers.length <= 20 && p.layers.every((l) => typeof l === "string" && l.length <= 20)))
  );
}

/** Puts `id` first in the recent list. */
export const pushRecent = (recent: readonly string[], id: string) => [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_MAX);

export interface BrowseContext {
  act: number;
  query: string;
  filter: AtlasFilter;
  favorites: readonly string[];
  recent: readonly string[];
  visited: ReadonlySet<string>;
  hintCount: ReadonlyMap<string, number>;
}

/**
 * Areas to list. A search looks across all acts; Favourites and Recent span all
 * acts too (Recent in visit order); the other filters apply to the chosen act.
 */
export function browseAreas(areas: readonly CampaignArea[], c: BrowseContext): CampaignArea[] {
  const q = c.query.trim().toLowerCase();
  if (c.filter === "recent" && !q) {
    const byId = new Map(areas.map((a) => [a.id, a]));
    return c.recent.flatMap((id) => byId.get(id) ?? []);
  }
  const wide = q !== "" || c.filter === "favorites";
  return areas.filter((a) => {
    if (!wide && a.act !== c.act) return false;
    if (q && !a.name.toLowerCase().includes(q) && !a.id.toLowerCase().includes(q)) return false;
    switch (c.filter) {
      case "towns":
        return a.kind === "town";
      case "waypoints":
        return a.waypoint;
      case "bosses":
        return a.kind === "area" && (a.bossCount > 0 || (a.bossNames?.length ?? 0) > 0);
      case "hints":
        return (c.hintCount.get(a.id) ?? 0) > 0;
      case "visited":
        return c.visited.has(a.id);
      case "favorites":
        return c.favorites.includes(a.id);
      default:
        return true;
    }
  });
}
