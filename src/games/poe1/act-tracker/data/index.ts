/**
 * Lazy loader for the Act Tracker (PoE 1) dataset: the generated route (one chunk, loaded on first use) and the
 * hand-checked reward database, validated against the Location Atlas area data (one source of area facts).
 */
import { loadDataset } from "@/games/poe1/location-atlas/data";
import type { CampaignArea } from "@/games/poe1/location-atlas/data/types";
import meta from "./3.30/meta.json";
import { ALL_REWARDS } from "./rewards";
import type { CampaignReward, RouteData, RouteMeta } from "./types";
import { validateRewards, validateRoute, type ValidationIssue } from "./validate";

export const ROUTE_META = meta as RouteMeta;

export interface TrackerDataset {
  route: RouteData;
  rewards: CampaignReward[];
  /** Campaign areas (Acts 1–10) from the Location Atlas dataset. */
  areas: Map<string, CampaignArea>;
}

let cache: Promise<{ dataset: TrackerDataset | null; issues: ValidationIssue[] }> | null = null;

export function loadTrackerDataset(): Promise<{ dataset: TrackerDataset | null; issues: ValidationIssue[] }> {
  cache ??= Promise.all([import("./3.30/route.json"), loadDataset()])
    .then(([routeModule, atlas]) => {
      const route = routeModule.default as unknown as RouteData;
      const areas = new Map(atlas.dataset.acts.flatMap((a) => a.areas.map((x) => [x.id, x] as const)));
      const known = (id: string) => areas.has(id);
      const issues = [...atlas.issues, ...validateRoute(route, known), ...validateRewards(ALL_REWARDS, route, known)];
      const broken = issues.some((i) => i.severity === "error");
      return { dataset: broken ? null : { route, rewards: ALL_REWARDS, areas }, issues };
    })
    .catch((e) => ({ dataset: null, issues: [{ severity: "error" as const, where: "act tracker", message: String(e) }] }));
  return cache;
}
