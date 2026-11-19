/**
 * Where the character is, from the stored campaign events (pure). This is not a
 * second detector: events come from the shared reader/parser/campaign hook; this
 * only reads them against the dataset. Client.txt names the area entered — never a
 * position inside it — so the Atlas knows the area, not where you stand in it.
 */
import type { CampaignEventRow } from "@/core/ipc/commands";
import type { CampaignArea } from "./data/types";

export type LocationState =
  /** The latest area entered is a campaign area. */
  | { kind: "in-area"; area: CampaignArea; at: number; level: number | null }
  /** The latest area is outside the campaign (hideout, map, Labyrinth…); `last` is the last campaign area. */
  | { kind: "outside"; areaId: string; at: number; last: CampaignArea | null }
  /** No area entered yet for this character. */
  | { kind: "unknown" };

export interface CharacterLocation {
  location: LocationState;
  /** Campaign areas entered at least once. */
  visited: Set<string>;
  /** Highest act entered. */
  act: number | null;
  level: number | null;
  /** Area ids in the log that the dataset doesn't know (patch drift). */
  unknownAreas: string[];
}

const CAMPAIGN_ID = /^[12]_\d+_/;

export function locate(events: readonly CampaignEventRow[], areas: ReadonlyMap<string, CampaignArea>): CharacterLocation {
  const visited = new Set<string>();
  const unknown = new Set<string>();
  let location: LocationState = { kind: "unknown" };
  let last: CampaignArea | null = null;
  let level: number | null = null;
  let act: number | null = null;
  for (const e of events) {
    if (e.kind === "level" && e.amount != null) level = e.amount;
    if (e.kind !== "zone" || !e.areaId) continue;
    const area = areas.get(e.areaId);
    if (area) {
      visited.add(area.id);
      last = area;
      act = Math.max(act ?? 0, area.act);
      location = { kind: "in-area", area, at: e.at, level: e.areaLevel };
    } else {
      if (CAMPAIGN_ID.test(e.areaId) && !/_endgame_town$/.test(e.areaId)) unknown.add(e.areaId);
      location = { kind: "outside", areaId: e.areaId, at: e.at, last };
    }
  }
  return { location, visited, act, level, unknownAreas: [...unknown] };
}
