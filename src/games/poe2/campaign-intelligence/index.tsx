/**
 * Campaign Intelligence (PoE 2): a navigator that answers "where do I go now,
 * what do I do there, and what comes after" from the character's Client.txt
 * progress and the verified 0.5.5 campaign dataset.
 * Spec: docs/modules/campaign-intelligence.md
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import { campaignBuildStats, campaignImportLog, type CampaignBuildStats } from "@/core/ipc/commands";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { Button, EmptyState, PageHeader, Panel, ProvenanceTag, SegmentedControl, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { CAMPAIGN_0_5_5 } from "./data/0.5.5";
import { recommend, type CampaignMode, type Recommendation } from "./engine/recommend";
import { missedObjectives } from "./engine/recovery";
import { heldItemWarnings, rewardStatuses } from "./engine/rewards";
import { campaignGraph, revisionOf, useCampaignCharacters, useCampaignStatus, useCharacterProgress } from "./hooks";
import { NextObjective } from "./NextObjective";
import { CONFIG_KEY, DEFAULT_CONFIG, isCampaignConfig, MODE_HELP, MODE_LABEL, toModeSettings } from "./settings";
import { buildHints } from "./engine/build";
import { RecoveryTab } from "./RecoveryTab";
import { RouteTab } from "./RouteTab";
import { SettingsTab } from "./SettingsTab";
import { RewardsTab } from "./RewardsTab";
import { HistoryTab } from "./HistoryTab";
import { JournalTab } from "./JournalTab";
import { ZonePanel } from "./ZonePanel";
import { runStats } from "./engine/history";
import { ObjectiveRow, SectionLabel } from "./ui";

const GAME = "poe2" as const;
type Tab = "navigator" | "route" | "rewards" | "recovery" | "journal" | "history" | "settings";
const TABS = [
  { value: "navigator", label: "Navigator" },
  { value: "route", label: "Route" },
  { value: "rewards", label: "Rewards" },
  { value: "recovery", label: "Missed" },
  { value: "journal", label: "Journal" },
  { value: "history", label: "History" },
  { value: "settings", label: "Settings" },
] as const;
const MODES = (Object.keys(MODE_LABEL) as CampaignMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }));

export default function CampaignIntelligence(_props: SectionProps) {
  const notify = useToast();
  const status = useCampaignStatus(GAME);
  const revision = revisionOf(status.data);
  const chars = useCampaignCharacters(GAME, revision);
  const [config, setConfig, configLoaded] = useGameSetting(GAME, CONFIG_KEY, DEFAULT_CONFIG, isCampaignConfig);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Objective the player chose to do next ("Do this next"), for this visit. */
  const [focus, setFocus] = useState<string | null>(null);
  const previous = useRef<string | null>(null);
  const [tab, setTab] = useState<Tab>("navigator");

  const visible = (chars.data ?? []).filter((c) => !c.hidden && c.campaignZones > 0);
  const characterId =
    (config.characterId !== null && visible.some((c) => c.id === config.characterId) ? config.characterId : null) ??
    (visible.some((c) => c.id === status.data?.activeCharacterId) ? status.data!.activeCharacterId : null) ??
    visible[0]?.id ??
    null;
  const character = visible.find((c) => c.id === characterId) ?? null;
  const cp = useCharacterProgress(GAME, characterId, revision);

  // Linked PoB build → build-aware hints (planned build numbers, not live stats).
  const buildRel = characterId !== null ? ((config.builds ?? {})[String(characterId)] ?? null) : null;
  const [build, setBuild] = useState<{ rel: string; stats: CampaignBuildStats | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!buildRel) {
      setBuild(null);
      return;
    }
    let cancelled = false;
    campaignBuildStats(GAME, buildRel)
      .then((stats) => !cancelled && setBuild({ rel: buildRel, stats, error: null }))
      .catch((e) => !cancelled && setBuild({ rel: buildRel, stats: null, error: `Couldn't read the build: ${String(e)}` }));
    return () => {
      cancelled = true;
    };
  }, [buildRel]);
  const hints = useMemo(
    () => (build?.stats && build.rel === buildRel ? buildHints(campaignGraph(), build.stats, character?.class ?? null) : null),
    [build, buildRel, character?.class],
  );

  const rec: Recommendation | null = useMemo(() => {
    if (!cp.progress) return null;
    const settings = toModeSettings(config);
    const r = recommend(campaignGraph(), cp.progress, {
      settings: focus ? { ...settings, pinned: [focus, ...settings.pinned] } : settings,
      previous: previous.current,
      boosts: hints?.boosts,
    });
    return r;
  }, [cp.progress, config, focus, hints]);
  if (rec) previous.current = rec.primary?.objective.id ?? null;
  const stats = useMemo(() => (cp.progress && cp.engineEvents ? runStats(campaignGraph(), cp.engineEvents, cp.progress) : null), [cp.progress, cp.engineEvents]);
  const missedCount = useMemo(() => (cp.progress ? missedObjectives(campaignGraph(), cp.progress).length : 0), [cp.progress]);
  const held = useMemo(
    () => (cp.progress && cp.rewardMarks ? heldItemWarnings(campaignGraph(), rewardStatuses(campaignGraph(), cp.progress, cp.rewardMarks)) : []),
    [cp.progress, cp.rewardMarks],
  );

  const runImport = async () => {
    setImporting(true);
    try {
      const s = await campaignImportLog(GAME);
      notify("success", "History imported", `${s.lines.toLocaleString()} lines read, ${s.eventsStored.toLocaleString()} new campaign events, ${s.characters} character(s).`);
      chars.reload();
      status.reload();
      cp.reload();
    } catch (e) {
      notify("warning", "Couldn't import Client.txt", String(e));
    } finally {
      setImporting(false);
    }
  };

  const save = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      notify("warning", "Couldn't save", String(e));
    } finally {
      setBusy(false);
    }
  };

  const mark = async (objectiveId: string, m: "done" | "skipped" | "not-done" | null, choice: string | null = null) => {
    setBusy(true);
    try {
      await cp.setMark(objectiveId, m, choice);
      if (focus === objectiveId) setFocus(null);
    } catch (e) {
      notify("warning", "Couldn't save", String(e));
    } finally {
      setBusy(false);
    }
  };

  const importButton = (
    <Button size="sm" variant="secondary" icon="download" disabled={importing} onClick={runImport} title="Read your whole Client.txt once to find characters already in the campaign">
      {importing ? "Importing…" : "Import history"}
    </Button>
  );

  const header = (
    <PageHeader
      title="Campaign Intelligence"
      description="Where to go next in the Path of Exile 2 campaign, what to do there and why — from your Client.txt (read-only) and verified 0.5.5 campaign data."
      actions={importButton}
    />
  );

  if ((chars.error && !chars.data) || (status.error && !status.data)) {
    return (
      <div className="mx-auto max-w-page">
        {header}
        <EmptyState icon="error" title="Campaign data is unavailable" body={chars.error ?? status.error} />
      </div>
    );
  }
  if (!chars.data || !configLoaded) {
    return (
      <div className="mx-auto max-w-page">
        {header}
        <EmptyState icon="map" title="Loading…" loading />
      </div>
    );
  }
  if (!character) {
    return (
      <div className="mx-auto max-w-page">
        {header}
        <Panel>
          <EmptyState
            icon="map"
            title="No campaign character yet"
            body="Play with Session Intelligence tracking on and your character appears after its first level-up in the campaign. If you're already mid-campaign, import your Client.txt history once."
            action={importButton}
          />
        </Panel>
      </div>
    );
  }

  const g = campaignGraph();
  const p = cp.progress;
  const compat = status.compatibility;
  const zone = p?.currentZone ? g.zone.get(p.currentZone) : null;
  const mainTotal = CAMPAIGN_0_5_5.objectives.filter((o) => o.kind === "main").length;
  const mainDone = p ? CAMPAIGN_0_5_5.objectives.filter((o) => o.kind === "main" && p.objectives.get(o.id)?.status === "done").length : 0;

  return (
    <div className="mx-auto max-w-page">
      {header}

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <Select
          label="Character"
          value={String(character.id)}
          onChange={(v) => setConfig({ ...config, characterId: Number(v) })}
          options={visible.map((c) => ({ value: String(c.id), label: `${c.name} · ${c.class} · ${c.level}${c.id === status.data?.activeCharacterId ? " · in game" : ""}` }))}
        />
        <div title={MODE_HELP[config.mode]}>
          <SegmentedControl label="Campaign mode" value={config.mode} onChange={(mode) => setConfig({ ...config, mode })} segments={MODES} />
        </div>
        <div className="ml-auto">
          <SegmentedControl label="Section" value={tab} onChange={setTab} segments={TABS} />
        </div>
      </div>

      {compat && compat.kind !== "match" && (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-warning">
          <Icon name="warning" size={14} className="mt-px shrink-0" />
          {compat.kind === "different"
            ? `Your game client is ${compat.clientPatch}; the campaign data was checked for ${compat.datasetPatch}. Instructions may be outdated.`
            : `The game version couldn't be read from Client.txt${compat.tag ? ` (${compat.tag})` : ""}; the campaign data is for ${CAMPAIGN_0_5_5.patch}.`}
        </p>
      )}

      {cp.error && !p ? (
        <EmptyState icon="error" title="Couldn't load this character's progress" body={cp.error} />
      ) : !p || !rec || !cp.rewardMarks ? (
        <EmptyState icon="map" title="Loading progress…" loading />
      ) : tab === "rewards" ? (
        <RewardsTab progress={p} rewardMarks={cp.rewardMarks} busy={busy} onSetStage={(id, stage, choice) => save(() => cp.setRewardMark(id, stage, choice))} />
      ) : tab === "route" ? (
        <RouteTab progress={p} settings={toModeSettings(config)} />
      ) : tab === "settings" ? (
        <SettingsTab
          config={config}
          setConfig={setConfig}
          character={character}
          characters={chars.data}
          build={build?.stats ?? null}
          buildError={build?.error ?? null}
          buildLines={hints?.lines ?? []}
          onCharactersChanged={() => {
            chars.reload();
            status.reload();
          }}
        />
      ) : tab === "journal" ? (
        <JournalTab progress={p} marks={cp.marks ?? []} busy={busy} onMark={(id, m) => void mark(id, m)} />
      ) : tab === "history" ? (
        <HistoryTab character={character} characters={chars.data} events={cp.engineEvents ?? []} progress={p} rewardMarks={cp.rewardMarks} />
      ) : tab === "recovery" ? (
        <RecoveryTab progress={p} busy={busy} onDone={(id) => mark(id, "done")} onReset={(id) => mark(id, null)} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <NextObjective rec={rec} busy={busy} onDone={(id, choice) => mark(id, "done", choice)} onSkip={(id) => mark(id, "skipped")} />

            {rec.alsoHere.length > 0 && (
              <Panel title={`Also in ${rec.primary!.zone.name}`} flush>
                <ul className="divide-y divide-line">
                  {rec.alsoHere.map((e) => (
                    <ObjectiveRow key={e.objective.id} entry={e} busy={busy} onDone={() => mark(e.objective.id, "done")} onSkip={() => mark(e.objective.id, "skipped")} onFocus={() => setFocus(e.objective.id)} />
                  ))}
                </ul>
              </Panel>
            )}
            {rec.secondary.length > 0 && (
              <Panel title="Other options" flush>
                <ul className="divide-y divide-line">
                  {rec.secondary.map((e) => (
                    <ObjectiveRow key={e.objective.id} entry={e} busy={busy} onDone={() => mark(e.objective.id, "done")} onSkip={() => mark(e.objective.id, "skipped")} onFocus={() => setFocus(e.objective.id)} />
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <Panel title="Where you are" actions={<ProvenanceTag provenance={{ kind: "user", source: "Your Client.txt (read-only)", at: null, note: "Progress is derived on this PC; nothing is sent anywhere." }} />}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                <div className="col-span-2">
                  <dt className="text-2xs text-fg-subtle">Zone</dt>
                  <dd className="mt-0.5 text-sm text-fg">{zone ? `${zone.name} · ${g.part.get(zone.part)!.name}` : "Outside the campaign (hideout, map or unknown area)"}</dd>
                </div>
                <div>
                  <dt className="text-2xs text-fg-subtle">Character level</dt>
                  <dd className="mt-0.5 text-sm text-fg tabular-nums">{p.level ?? character.level}</dd>
                </div>
                <div>
                  <dt className="text-2xs text-fg-subtle">Area level</dt>
                  <dd className="mt-0.5 text-sm text-fg tabular-nums">
                    {p.currentAreaLevel ?? "—"}
                    {p.currentAreaLevel != null && p.level != null && (
                      <span className="ml-1.5 text-fg-muted">({p.currentAreaLevel - p.level >= 0 ? "+" : ""}{p.currentAreaLevel - p.level})</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-2xs text-fg-subtle" title="Main-quest steps known to be done (from the log or your marks)">Main quest steps done</dt>
                  <dd className="mt-0.5 text-sm text-fg tabular-nums">
                    {mainDone} / {mainTotal}
                  </dd>
                </div>
                <div>
                  <dt className="text-2xs text-fg-subtle">Ascendancy</dt>
                  <dd className="mt-0.5 text-sm text-fg">{p.ascended ? p.ascended.toClass : character.class !== character.baseClass ? character.class : "Not yet"}</dd>
                </div>
              </dl>
            </Panel>

            {(p.currentZone ?? rec.primary?.zone.id) && (
              <ZonePanel zoneId={(p.currentZone ?? rec.primary!.zone.id)!} here={p.currentZone !== null} progress={p} stats={stats} />
            )}

            <Panel title="Why this objective">
              <p className="text-xs leading-relaxed text-fg-muted">{rec.explanation}</p>
              {rec.primary && (
                <ul className="mt-2 flex flex-col gap-1 text-xs text-fg-muted">
                  {rec.primary.reasons.map((r) => (
                    <li key={r} className="flex gap-2">
                      <Icon name="chevronRight" size={12} className="mt-0.5 shrink-0 text-fg-subtle" />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-2xs text-fg-subtle">
                {hints
                  ? `Build-aware: ${build?.stats?.name} (planned build from Path of Building, not live stats).`
                  : "Generic recommendation — link a Path of Building build in Settings for build-aware hints."}
              </p>
              {focus && (
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setFocus(null)}>
                  Back to the automatic choice
                </Button>
              )}
            </Panel>

            {(rec.warnings.length > 0 || held.length > 0 || missedCount > 0) && (
              <Panel title="Warnings">
                <ul className="flex flex-col gap-2">
                  {[...held, ...rec.warnings.map((w) => w.text)].map((w) => (
                    <li key={w} className="flex items-start gap-2 text-xs text-fg-muted">
                      <Icon name="warning" size={13} className="mt-px shrink-0 text-warning" />
                      {w}
                    </li>
                  ))}
                  {missedCount > 0 && (
                    <li className="flex items-start gap-2 text-xs text-fg-muted">
                      <Icon name="info" size={13} className="mt-px shrink-0" />
                      <span className="flex-1">
                        {missedCount} reward{missedCount === 1 ? "" : "s"} possibly missed or skipped.
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => setTab("recovery")}>
                        Review
                      </Button>
                    </li>
                  )}
                </ul>
              </Panel>
            )}

            <Panel title="Data">
              <SectionLabel>Campaign data</SectionLabel>
              <p className="text-xs text-fg-muted">
                Patch {CAMPAIGN_0_5_5.patch}, checked {CAMPAIGN_0_5_5.verifiedOn}. Cross-checked between community guides and a real client log; entries where sources disagree are marked.
              </p>
              <div className="mt-2">
                <ProvenanceTag provenance={{ kind: "game-data", source: CAMPAIGN_0_5_5.sources.map((s) => s.label).join("; "), at: null, patch: CAMPAIGN_0_5_5.patch }} />
              </div>
              {p.unknownAreas.length > 0 && (
                <p className="mt-3 flex items-start gap-2 text-2xs text-warning">
                  <Icon name="warning" size={12} className="mt-px shrink-0" />
                  <span>
                    {p.unknownAreas.length} campaign area{p.unknownAreas.length === 1 ? "" : "s"} in your log {p.unknownAreas.length === 1 ? "isn't" : "aren't"} in the{" "}
                    {CAMPAIGN_0_5_5.patch} data ({p.unknownAreas.slice(0, 4).join(", ")}
                    {p.unknownAreas.length > 4 ? ", …" : ""}). Progress there isn't tracked; the data may be outdated for your game version.
                  </span>
                </p>
              )}
              {p.unattributedGrants.length > 0 && (
                <p className="mt-3 text-2xs text-fg-subtle">
                  {p.unattributedGrants.length} passive point grant{p.unattributedGrants.length === 1 ? "" : "s"} in campaign areas couldn't be tied to an objective — check
                  the Rewards tab and confirm by hand if needed.
                </p>
              )}
              {status.data && status.data.unassignedEvents > 0 && (
                <p className="mt-3 text-2xs text-fg-subtle">
                  {status.data.unassignedEvents.toLocaleString()} log event(s) wait for a character: they are assigned after the first level-up following a login.
                </p>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
