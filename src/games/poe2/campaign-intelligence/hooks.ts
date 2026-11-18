/**
 * Campaign data hooks. No polling: only the small status query listens to the
 * shared Client.txt reader (`session:updated`, ≤ 1/s from Rust). Characters and
 * events are re-read only when the status' change token moves (a new campaign
 * event or a late character assignment) — map runs and hideout visits that
 * store nothing for the campaign cost one indexed query. Marks change only
 * from this page and are re-read after saving. The progress derivation is
 * memoised and runs only when events or marks change.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameId } from "@/core/game-context/games";
import {
  campaignCharacters,
  campaignEvents,
  campaignMarks,
  campaignRewardMarks,
  campaignSetMark,
  campaignSetRewardMark,
  campaignStatus,
  type CampaignCharacter,
  type CampaignEventRow,
  type CampaignMark,
  type CampaignRewardMark,
  type CampaignRewardStage,
  type CampaignStatus,
} from "@/core/ipc/commands";
import { useSessionUpdates } from "../session-intelligence/hooks";
import { CAMPAIGN_0_5_5 } from "./data/0.5.5";
import { toEngineEvents } from "./engine/events";
import { buildGraph, type CampaignGraph } from "./engine/graph";
import { deriveProgress, type CampaignEvent, type CampaignProgress, type ManualMark } from "./engine/progress";
import { compatibility, type Compatibility } from "./engine/version";

/** Built once per app run. */
let cachedGraph: CampaignGraph | null = null;
export function campaignGraph(): CampaignGraph {
  cachedGraph ??= buildGraph(CAMPAIGN_0_5_5);
  return cachedGraph;
}

const NOOP = () => {};

/** Change token for characters/events, from the campaign status (null while it loads). */
export const revisionOf = (s: CampaignStatus | null) => (s ? `${s.revision}:${s.unassignedEvents}:${s.activeCharacterId ?? ""}` : null);

interface Loaded<T> {
  data: T | null;
  error: string | null;
  reload: () => void;
}

function useLoaded<T>(game: GameId, load: () => Promise<T>, deps: unknown[], live = false): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    const id = ++req.current;
    load()
      .then((d) => {
        if (id !== req.current) return;
        // Same content → keep the old reference so memoised work downstream doesn't rerun.
        setData((old) => (old !== null && JSON.stringify(old) === JSON.stringify(d) ? old : d));
        setError(null);
      })
      .catch((e) => id === req.current && setError(String(e)));
  }, deps);
  useEffect(reload, [reload]);
  useSessionUpdates(game, live ? reload : NOOP);
  return { data, error, reload };
}

export function useCampaignStatus(game: GameId): Loaded<CampaignStatus> & { compatibility: Compatibility | null } {
  const r = useLoaded(game, () => campaignStatus(game), [game], true);
  const compat = useMemo(() => (r.data ? compatibility(CAMPAIGN_0_5_5.patch, r.data.clientTag) : null), [r.data]);
  return { ...r, compatibility: compat };
}

export function useCampaignCharacters(game: GameId, revision: string | null): Loaded<CampaignCharacter[]> {
  return useLoaded(game, () => campaignCharacters(game), [game, revision]);
}

export interface CharacterProgress {
  progress: CampaignProgress | null;
  /** Normalised engine events (oldest first). */
  engineEvents: CampaignEvent[] | null;
  events: CampaignEventRow[] | null;
  marks: CampaignMark[] | null;
  error: string | null;
  reload: () => void;
  rewardMarks: CampaignRewardMark[] | null;
  /** Saves a manual mark and re-derives progress. `null` = back to automatic. */
  setMark: (objectiveId: string, mark: CampaignMark["mark"] | null, choice?: string | null) => Promise<void>;
  /** Saves the player's claim stage for one reward. `null` = back to automatic. */
  setRewardMark: (rewardId: string, stage: CampaignRewardStage | null, choice?: string | null) => Promise<void>;
}

export function useCharacterProgress(game: GameId, characterId: number | null, revision: string | null): CharacterProgress {
  const ev = useLoaded(game, () => (characterId === null ? Promise.resolve(null) : campaignEvents(game, characterId)), [game, characterId, revision]);
  const mk = useLoaded(game, () => (characterId === null ? Promise.resolve(null) : campaignMarks(game, characterId)), [game, characterId]);
  const rm = useLoaded(game, () => (characterId === null ? Promise.resolve(null) : campaignRewardMarks(game, characterId)), [game, characterId]);
  const engineEvents = useMemo(() => (ev.data ? toEngineEvents(ev.data) : null), [ev.data]);
  const progress = useMemo(() => {
    if (!engineEvents || !mk.data) return null;
    const marks: ManualMark[] = mk.data.map((m) => ({ objective: m.objectiveId, mark: m.mark, at: m.at, choice: m.choice ?? undefined }));
    return deriveProgress(campaignGraph(), engineEvents, marks);
  }, [engineEvents, mk.data]);
  const reloadMarks = mk.reload;
  const setMark = useCallback(
    async (objectiveId: string, mark: CampaignMark["mark"] | null, choice: string | null = null) => {
      if (characterId === null) return;
      await campaignSetMark(game, characterId, objectiveId, mark, choice);
      reloadMarks();
    },
    [game, characterId, reloadMarks],
  );
  const reloadRewardMarks = rm.reload;
  const setRewardMark = useCallback(
    async (rewardId: string, stage: CampaignRewardStage | null, choice: string | null = null) => {
      if (characterId === null) return;
      await campaignSetRewardMark(game, characterId, rewardId, stage, choice);
      reloadRewardMarks();
    },
    [game, characterId, reloadRewardMarks],
  );
  return {
    progress,
    engineEvents,
    events: ev.data,
    marks: mk.data,
    rewardMarks: rm.data,
    error: ev.error ?? mk.error ?? rm.error,
    reload: () => {
      ev.reload();
      mk.reload();
      rm.reload();
    },
    setMark,
    setRewardMark,
  };
}
