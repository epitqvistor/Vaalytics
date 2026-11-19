/**
 * Act Tracker (PoE 1) hooks: dataset, preferences, marks and the derived route progress.
 *
 * Location comes from the shared PoE 1 tracking (`useAtlasTracking`: the shared Client.txt reader + campaign
 * hook, synced every 2 s only while the view is visible). The overlay unmounts its body while hidden, so a hidden
 * overlay reads nothing. Marks / preferences changed in one window are broadcast to the other (`CHANGED_EVENT`).
 */
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  campaignCharacters,
  campaignEvents,
  campaignMarks,
  campaignRewardMarks,
  campaignSetMark,
  campaignSetRewardMark,
  getGameSetting,
  setGameSetting,
  type CampaignMark,
  type CampaignRewardMark,
  type CampaignRewardStage,
  type JsonValue,
} from "@/core/ipc/commands";
import { useAtlasTracking, type AtlasTracking } from "@/games/poe1/location-atlas/hooks";
import { loadTrackerDataset, type TrackerDataset } from "./data";
import type { ValidationIssue } from "./data/validate";
import { guardian, passivesSnapshots, type GuardianReport } from "./engine/guardian";
import { campaignTimes, type CampaignTimes, type RunSummary } from "./engine/timer";
import { isImportantStep, prioritise, type PrioritisedStep } from "./engine/priorities";
import { returnTrips, wayBack, type ReturnTrip, type WayPlan } from "./engine/recovery";
import type { StepFilter } from "./engine/view";
import { deriveProgress, STEP_MARK_PREFIX, stepMarkId, type RouteProgress } from "./engine/progress";
import { areaName, resolveRoute, type ResolvedStep } from "./engine/route";
import { CHANGED_EVENT, DEFAULT_PREFS, normalizePrefs, PREFS_KEY, type TrackerPrefs } from "./prefs";
import { applyProfile, BUILT_IN_ID, PROFILES_KEY, readProfiles, withOverrides, type AppliedRoute, type UserProfile } from "./engine/profiles";

const GAME = "poe1" as const;

/** Runs `fn` when the other window reports a change (and returns a broadcaster for our own changes). */
function useChangedEvent(fn: () => void): () => void {
  useEffect(() => {
    if (!isTauri()) return;
    const p = listen(CHANGED_EVENT, () => fn());
    return () => void p.then((u) => u());
  }, [fn]);
  return useCallback(() => {
    if (isTauri()) void emit(CHANGED_EVENT).catch(() => {});
  }, []);
}

export function useTrackerDataset(): { dataset: TrackerDataset | null; issues: ValidationIssue[]; loading: boolean } {
  const [state, setState] = useState<{ dataset: TrackerDataset | null; issues: ValidationIssue[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadTrackerDataset().then((r) => !cancelled && setState(r));
    return () => {
      cancelled = true;
    };
  }, []);
  return { dataset: state?.dataset ?? null, issues: state?.issues ?? [], loading: state === null };
}

export function useTrackerPrefs(): [TrackerPrefs, (p: TrackerPrefs) => void, boolean] {
  const [prefs, setPrefs] = useState<TrackerPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => {
    getGameSetting(GAME, PREFS_KEY)
      .then((v) => setPrefs(normalizePrefs(v)))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(reload, [reload]);
  const broadcast = useChangedEvent(reload);
  const update = useCallback(
    (p: TrackerPrefs) => {
      setPrefs(p);
      setGameSetting(GAME, PREFS_KEY, p as unknown as JsonValue)
        .then(broadcast)
        .catch((e) => console.warn("Could not save Act Tracker preferences", e));
    },
    [broadcast],
  );
  return [prefs, update, loaded];
}

/** Your guide profiles (`actTracker.profiles`), shared between the windows like the preferences. */
export function useProfiles(): [UserProfile[], (p: UserProfile[]) => Promise<void>, boolean] {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => {
    getGameSetting(GAME, PROFILES_KEY)
      .then((v) => setProfiles(readProfiles(v)))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(reload, [reload]);
  const broadcast = useChangedEvent(reload);
  const save = useCallback(
    async (p: UserProfile[]) => {
      await setGameSetting(GAME, PROFILES_KEY, p as unknown as JsonValue);
      setProfiles(p);
      broadcast();
    },
    [broadcast],
  );
  return [profiles, save, loaded];
}

export interface Tracker {
  dataset: TrackerDataset | null;
  issues: ValidationIssue[];
  tracking: AtlasTracking;
  steps: ResolvedStep[];
  progress: RouteProgress | null;
  marks: CampaignMark[] | null;
  /** Set (or clear, with null) the player's mark for a step. */
  mark: (step: ResolvedStep, mark: CampaignMark["mark"] | null) => Promise<void>;
  /** Set (or clear) the player's claim stage for a reward. */
  markReward: (rewardId: string, stage: CampaignRewardStage | null) => Promise<void>;
  markError: string | null;
  report: GuardianReport | null;
  /** Priority of each resolved step (same index). */
  priorities: PrioritisedStep[];
  /** Steps the guide shows (all, or "important only"). */
  show: StepFilter;
  /** Way back to the guide's area when you are elsewhere. */
  way: WayPlan | null;
  trips: ReturnTrip[];
  /** Campaign timer for the followed character (estimate). */
  times: CampaignTimes | null;
  /** The active profile (null = the built-in one) and its applied edits. */
  profile: UserProfile | null;
  applied: AppliedRoute | null;
}

export function useTracker(prefs: TrackerPrefs): Tracker {
  const { dataset, issues } = useTrackerDataset();
  const areas = useMemo(() => dataset?.areas ?? new Map(), [dataset]);
  const tracking = useAtlasTracking(areas, prefs.characterId);
  return useTrackerWith(prefs, dataset, issues, tracking);
}

/**
 * The tracker on top of tracking someone else already runs (the Location Atlas window passes its own
 * `useAtlasTracking` result), so embedding it never starts a second log sync.
 */
export function useTrackerWith(prefs: TrackerPrefs, dataset: TrackerDataset | null, issues: ValidationIssue[], tracking: AtlasTracking): Tracker {
  const cid = tracking.character?.id ?? null;
  const [marks, setMarks] = useState<CampaignMark[] | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);

  const [rewardMarks, setRewardMarks] = useState<CampaignRewardMark[] | null>(null);
  const loadMarks = useCallback(() => {
    if (cid === null) {
      setMarks(null);
      setRewardMarks(null);
      return;
    }
    campaignMarks(GAME, cid)
      .then((m) => setMarks(m))
      .catch((e) => setMarkError(String(e)));
    campaignRewardMarks(GAME, cid)
      .then((m) => setRewardMarks(m))
      .catch((e) => setMarkError(String(e)));
  }, [cid]);
  useEffect(loadMarks, [loadMarks]);
  const broadcast = useChangedEvent(loadMarks);

  const [profiles] = useProfiles();
  const profile = prefs.profileId === BUILT_IN_ID ? null : (profiles.find((p) => p.id === prefs.profileId) ?? null);
  const applied = useMemo(
    () => (dataset && profile ? applyProfile(dataset.route, profile.options, profile.edits, dataset.areas) : null),
    [dataset, profile],
  );
  const steps = useMemo(
    () => (applied ? applied.steps : dataset ? resolveRoute(dataset.route, prefs.options, dataset.areas) : []),
    [applied, dataset, prefs.options],
  );
  const bandit = profile ? profile.options.bandit : prefs.options.bandit;
  const progress = useMemo(
    () =>
      dataset && tracking.events
        ? deriveProgress({ steps, events: tracking.events, marks: marks ?? [], areas: dataset.areas, route: dataset.route })
        : null,
    [dataset, steps, tracking.events, marks],
  );

  const mark = useCallback(
    async (step: ResolvedStep, m: CampaignMark["mark"] | null) => {
      if (cid === null) return;
      try {
        await campaignSetMark(GAME, cid, stepMarkId(step.id), m);
        setMarkError(null);
        loadMarks();
        broadcast();
      } catch (e) {
        setMarkError(String(e));
      }
    },
    [cid, loadMarks, broadcast],
  );

  const markReward = useCallback(
    async (rewardId: string, stage: CampaignRewardStage | null) => {
      if (cid === null) return;
      try {
        await campaignSetRewardMark(GAME, cid, rewardId, stage);
        setMarkError(null);
        loadMarks();
        broadcast();
      } catch (e) {
        setMarkError(String(e));
      }
    },
    [cid, loadMarks, broadcast],
  );

  const report = useMemo(
    () =>
      dataset && progress && tracking.events
        ? guardian({
            rewards: dataset.rewards,
            steps,
            progress,
            events: tracking.events,
            rewardMarks: rewardMarks ?? [],
            bandit,
            name: (id) => areaName(id, dataset.areas, dataset.route),
          })
        : null,
    [dataset, progress, steps, tracking.events, rewardMarks, bandit],
  );

  const priorities = useMemo(() => {
    if (!dataset) return [];
    const base = prioritise(steps, dataset.route, dataset.rewards);
    return applied ? withOverrides(base, steps, applied) : base;
  }, [dataset, steps, applied]);
  const show = useCallback<StepFilter>(
    (s) => !applied?.hidden.has(s.id) && (!prefs.importantOnly || (priorities[s.index] ? isImportantStep(priorities[s.index]!) : true)),
    [prefs.importantOnly, priorities, applied],
  );
  const guideArea = progress ? (steps[progress.cursor]?.area ?? null) : null;
  const way = useMemo(
    () => (dataset && progress ? wayBack(dataset.areas, progress.visited, progress.position, guideArea) : null),
    [dataset, progress, guideArea],
  );
  const trips = useMemo(
    () => (dataset && progress && report ? returnTrips(report, dataset.areas, progress.visited, progress.position, steps[progress.cursor]?.act ?? 11) : []),
    [dataset, progress, report, steps],
  );

  const times = useMemo(() => (dataset && tracking.events ? campaignTimes(tracking.events, dataset.areas, dataset.route) : null), [dataset, tracking.events]);

  return { dataset, issues, tracking, steps, progress, marks, mark, markReward, markError, report, priorities, show, way, trips, times, profile, applied };
}

/**
 * Run history across the player's PoE 1 characters (each character = one campaign run). Loaded only when the
 * History view is shown; derived from the stored events every time, so it is always the same as the log says.
 */
export function useRunHistory(enabled: boolean, dataset: TrackerDataset | null, revision: number | null): { runs: RunSummary[] | null; error: string | null } {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !dataset) return;
    let cancelled = false;
    (async () => {
      try {
        const chars = (await campaignCharacters(GAME)).filter((c) => !c.hidden && c.campaignZones > 0);
        const out: RunSummary[] = [];
        for (const c of chars) {
          const [events, marks] = await Promise.all([campaignEvents(GAME, c.id), campaignMarks(GAME, c.id)]);
          const snaps = passivesSnapshots(events);
          const stepMarks = marks.filter((m) => m.objectiveId.startsWith(STEP_MARK_PREFIX));
          out.push({
            characterId: c.id,
            name: c.name,
            class: c.class,
            level: c.level,
            times: campaignTimes(events, dataset.areas, dataset.route),
            pointsInLog: events.filter((e) => e.kind === "passive_points").reduce((n, e) => n + (e.amount ?? 0), 0),
            pointsFromPassives: snaps[snaps.length - 1]?.fromQuests ?? null,
            deaths: events.filter((e) => e.kind === "death").length,
            skipped: stepMarks.filter((m) => m.mark === "skipped").length,
            confirmed: stepMarks.filter((m) => m.mark === "done").length,
          });
        }
        if (!cancelled) {
          setRuns(out.sort((a, b) => (b.times.lastAt ?? 0) - (a.times.lastAt ?? 0)));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, dataset, revision]);
  return { runs, error };
}
