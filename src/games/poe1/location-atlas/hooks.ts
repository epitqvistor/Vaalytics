/**
 * Location Atlas (PoE 1) data hooks.
 *
 * The PoE 1 log is read only while the Atlas is visible: `atlas_sync` every
 * SYNC_MS (it stats the file and reads what was appended — usually nothing) and
 * once when the view becomes visible again, which catches up everything played
 * while it was closed. Characters/events are re-read only when the campaign
 * status' change token moves. No polling while hidden.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  atlasSync,
  campaignCharacters,
  campaignEvents,
  campaignStatus,
  type CampaignCharacter,
  type CampaignEventRow,
  type CampaignStatus,
} from "@/core/ipc/commands";
import { loadDataset } from "./data";
import type { AtlasDataset, CampaignArea } from "./data/types";
import type { ValidationIssue } from "./data/validate";
import { locate, type CharacterLocation } from "./tracking";

const GAME = "poe1" as const;
export const SYNC_MS = 2000;

/** The whole dataset (all acts), loaded once. */
export function useAtlasDataset(): { dataset: AtlasDataset | null; areas: Map<string, CampaignArea>; issues: ValidationIssue[] } {
  const [state, setState] = useState<{ dataset: AtlasDataset; issues: ValidationIssue[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadDataset().then((r) => !cancelled && setState(r));
    return () => {
      cancelled = true;
    };
  }, []);
  const areas = useMemo(() => new Map((state?.dataset.acts ?? []).flatMap((a) => a.areas).map((a) => [a.id, a])), [state]);
  return { dataset: state?.dataset ?? null, areas, issues: state?.issues ?? [] };
}

export interface AtlasTracking {
  status: CampaignStatus | null;
  characters: CampaignCharacter[] | null;
  /** Character followed: the one the log shows in game, else the most recently seen. */
  character: CampaignCharacter | null;
  events: CampaignEventRow[] | null;
  location: CharacterLocation | null;
  /** Last read error (log missing, unreadable…); tracking keeps trying while visible. */
  error: string | null;
  syncing: boolean;
}

const sameJson = <T,>(a: T | null, b: T) => (a !== null && JSON.stringify(a) === JSON.stringify(b) ? a : b);

export function useAtlasTracking(areas: ReadonlyMap<string, CampaignArea>, characterId: number | null = null): AtlasTracking {
  const [status, setStatus] = useState<CampaignStatus | null>(null);
  const [characters, setCharacters] = useState<CampaignCharacter[] | null>(null);
  const [events, setEvents] = useState<CampaignEventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const tick = useCallback(async () => {
    if (busy.current || document.visibilityState !== "visible") return;
    busy.current = true;
    setSyncing(true);
    try {
      await atlasSync(GAME);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    try {
      const s = await campaignStatus(GAME);
      setStatus((old) => sameJson(old, s));
    } catch (e) {
      setError(String(e));
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void tick();
    const id = window.setInterval(() => void tick(), SYNC_MS);
    const onVisible = () => document.visibilityState === "visible" && void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tick]);

  const revision = status ? `${status.revision}:${status.unassignedEvents}:${status.activeCharacterId ?? ""}` : null;
  useEffect(() => {
    if (revision === null) return;
    let cancelled = false;
    campaignCharacters(GAME)
      .then((c) => !cancelled && setCharacters((old) => sameJson(old, c)))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [revision]);

  const visible = (characters ?? []).filter((c) => !c.hidden && c.campaignZones > 0);
  const character =
    visible.find((c) => c.id === characterId) ?? visible.find((c) => c.id === status?.activeCharacterId) ?? visible[0] ?? null;
  const cid = character?.id ?? null;

  useEffect(() => {
    if (revision === null || cid === null) {
      setEvents(null);
      return;
    }
    let cancelled = false;
    campaignEvents(GAME, cid)
      .then((e) => !cancelled && setEvents((old) => sameJson(old, e)))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [revision, cid]);

  const location = useMemo(() => (events && areas.size ? locate(events, areas) : null), [events, areas]);
  return { status, characters, character, events, location, error, syncing };
}
