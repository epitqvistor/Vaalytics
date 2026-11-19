/**
 * Guide profiles and route resolution (pure). A profile chooses the route options (bandit choice, Trials of
 * Ascendancy, league-start extras, the Library); resolving it gives the linear list of steps to follow, each with
 * the area it leads to (`to`) so the progress engine can match area entries from Client.txt.
 */
import type { CampaignArea } from "@/games/poe1/location-atlas/data/types";
import type { BanditChoice, RouteBlock, RouteData, RouteStep } from "../data/types";

export interface GuideOptions {
  bandit: BanditChoice;
  /** Detours to the twelve Trials of Ascendancy and the three Labyrinth runs (Ascendancy points). */
  trials: boolean;
  /** Everything else the source route does on a league start (extra quests, flasks, the Den…). */
  leagueStartExtras: boolean;
  /** Act 3 Library detour (gem vendor, A Fixture of Fate). */
  library: boolean;
}

export interface GuideProfile {
  id: string;
  name: string;
  /** Built-in profiles can't be edited; edits go to a copy. */
  builtIn: boolean;
  options: GuideOptions;
}

export const FAST_ALL_PASSIVES: GuideProfile = {
  id: "fast-all-passives",
  name: "Fast campaign — all passive points",
  builtIn: true,
  options: { bandit: "kill", trials: true, leagueStartExtras: false, library: false },
};

export const BUILT_IN_PROFILES: readonly GuideProfile[] = [FAST_ALL_PASSIVES];

/** Does a conditional block apply under these options? */
export function blockApplies(block: RouteBlock, o: GuideOptions): boolean {
  let on: boolean;
  switch (block.flag) {
    case "LEAGUE_START":
      // A league-start block that only adds a trial detour is a "trials" block; its #ifndef alternatives follow
      // the extras option, so the route stays one consistent path.
      if (block.negate) return !o.leagueStartExtras;
      return o.leagueStartExtras || (o.trials && block.trial && block.quests.length === 0);
    case "LIBRARY":
      on = o.library;
      break;
    case "BANDIT_KILL":
      on = o.bandit === "kill";
      break;
    case "BANDIT_ALIRA":
      on = o.bandit === "alira";
      break;
    case "BANDIT_KRAITYN":
      on = o.bandit === "kraityn";
      break;
    case "BANDIT_OAK":
      on = o.bandit === "oak";
      break;
  }
  return block.negate ? !on : on;
}

export interface ResolvedStep extends RouteStep {
  /** Position in the resolved route. */
  index: number;
  /** Area this step takes you to (enter / waypoint / logout / portal), or null when you stay. */
  to: string | null;
}

/** Town of an area: the area itself for towns, else the act town from the game data. */
export function townOf(areaId: string, areas: ReadonlyMap<string, CampaignArea>, route: RouteData): string | null {
  const a = areas.get(areaId);
  if (a) return a.kind === "town" ? a.id : a.town;
  return route.extraAreas[areaId]?.town ? areaId : null;
}

export function resolveRoute(route: RouteData, options: GuideOptions, areas: ReadonlyMap<string, CampaignArea>): ResolvedStep[] {
  const out: ResolvedStep[] = [];
  // Where the player is depends on the options taken (an optional detour may end elsewhere), so the position is
  // walked again here instead of trusting the generator's single-path `area`.
  let here = route.steps[0]?.area ?? "";
  let portalAt: string | null = null;
  for (const s of route.steps) {
    const block = s.when ? route.blocks[s.when.block] : undefined;
    if (s.when && (!block || !blockApplies(block, options))) continue;
    if (s.labTrip && !options.trials) continue;
    let to: string | null = null;
    const inTown = townOf(here, areas, route) === here;
    if (s.portal === "set") portalAt = here;
    if (s.enters?.length) to = s.enters[s.enters.length - 1] ?? null;
    else if (s.waypointTo) to = s.waypointTo;
    else if (s.portal === "use" && inTown && portalAt) to = portalAt;
    else if (s.kind === "logout" || s.kind === "portal") to = townOf(here, areas, route);
    out.push({ ...s, area: here, index: out.length, to: to === here ? null : to });
    if (to) here = to;
  }
  return out;
}

export function areaName(id: string | null, areas: ReadonlyMap<string, CampaignArea>, route: RouteData): string {
  if (!id) return "Unknown area";
  return areas.get(id)?.name ?? route.extraAreas[id]?.name ?? id;
}
