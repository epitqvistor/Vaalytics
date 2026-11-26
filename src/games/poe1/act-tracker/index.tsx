/**
 * Act Tracker (PoE 1) page in the main window: overlay controls, guide options and the expanded guide (every
 * step of an act with its status and your marks). Spec: docs/modules/act-tracker.md
 */
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import {
  ACT_TRACKER_STATE_EVENT,
  actTrackerHide,
  actTrackerOpen,
  actTrackerSetClickThrough,
  actTrackerSetHotkey,
  actTrackerState,
  atlasOpen,
  getGameSetting,
  hotkeyStatus,
  type ActTrackerWindowState,
  type HotkeyStatus,
} from "@/core/ipc/commands";
import { Badge, Button, EmptyState, Input, PageHeader, Panel, ProvenanceTag, SegmentedControl, Select, StatTile, Switch, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { ROUTE_META } from "./data";
import { BANDITS, expectedQuestPoints, SOURCES } from "./data/rewards";
import type { BanditChoice } from "./data/types";
import { FAST_ALL_PASSIVES, areaName, type GuideOptions, type ResolvedStep } from "./engine/route";
import { PRIORITY_LABEL, type PrioritisedStep, type StepPriority } from "./engine/priorities";
import { actProgress, currentObjective, type StepFilter } from "./engine/view";
import { ProfilesPanel, useStepEditor, type StepEditor } from "./GuideEditor";
import { useProfiles, useRunHistory, useTracker, useTrackerPrefs } from "./hooks";
import { HistoryPanel, TimerPanel } from "./TimerPanels";
import { GuardianPanel } from "./GuardianPanel";
import { DEFAULT_HOTKEY } from "./prefs";
import { EVIDENCE_LABEL, HintLine, outsideName, PositionBadge, StepText, WayLine } from "./ui";

const GAME = "poe1" as const;
const ACTS = Array.from({ length: 10 }, (_, k) => k + 1);

function useOverlayWindow(): [ActTrackerWindowState | null, (s: ActTrackerWindowState) => void] {
  const [state, setState] = useState<ActTrackerWindowState | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void actTrackerState(GAME).then(setState).catch(() => {});
    const p = listen<ActTrackerWindowState>(ACT_TRACKER_STATE_EVENT, (e) => setState(e.payload));
    return () => void p.then((u) => u());
  }, []);
  return [state, setState];
}

export default function ActTrackerPage(_props: SectionProps) {
  const notify = useToast();
  const [prefs, setPrefs, prefsLoaded] = useTrackerPrefs();
  const t = useTracker(prefs);
  const history = useRunHistory(true, t.dataset, t.tracking.status?.revision ?? null);
  const [profiles, saveProfiles] = useProfiles();
  const editor = useStepEditor(t.profile, profiles, saveProfiles, t.steps);
  // Route options belong to the active guide: yours, or your settings for the built-in one.
  const options = t.profile ? t.profile.options : prefs.options;
  const setOptions = (o: GuideOptions) => {
    const own = t.profile;
    if (own) void saveProfiles(profiles.map((p) => (p.id === own.id ? { ...p, options: o, updatedAt: Math.floor(Date.now() / 1000) } : p)));
    else setPrefs({ ...prefs, options: o });
  };
  const [win, setWin] = useOverlayWindow();
  const { dataset, progress, steps } = t;
  const name = useCallback((id: string | null) => (dataset ? areaName(id, dataset.areas, dataset.route) : (id ?? "")), [dataset]);
  const objective = useMemo(() => (progress ? currentObjective(steps, progress, 6, t.show) : null), [steps, progress, t.show]);
  const act = useMemo(() => (progress ? actProgress(steps, progress) : null), [steps, progress]);
  const [viewAct, setViewAct] = useState<number | null>(null);
  const shownAct = viewAct ?? act?.act ?? 1;

  const pos = progress?.position;
  const atlasArea =
    pos && pos.kind !== "none" && pos.kind !== "outside" && dataset?.areas.has(pos.areaId)
      ? pos.areaId
      : objective && dataset?.areas.has(objective.area)
        ? objective.area
        : null;
  const openAtlas = (area: string) => void atlasOpen(GAME, area).catch((e) => notify("warning", "Couldn't open the Location Atlas", String(e)));

  const run = (p: Promise<ActTrackerWindowState>, what: string) =>
    p.then(setWin).catch((e) => notify("warning", `Couldn't ${what} the overlay`, String(e)));

  const characters = (t.tracking.characters ?? []).filter((c) => !c.hidden && c.campaignZones > 0);
  const expected = expectedQuestPoints(options.bandit);

  return (
    <div className="mx-auto max-w-page">
      <PageHeader
        title="Act Tracker"
        description="Your Path of Exile campaign guide, Acts 1–10: where you are, the current objective and the next steps — in a small overlay that stays on top of the game."
        actions={
          win?.visible ? (
            <Button variant="secondary" icon="close" onClick={() => run(actTrackerHide(GAME), "hide")}>
              Hide overlay
            </Button>
          ) : (
            <Button variant="primary" icon="waypoint" onClick={() => run(actTrackerOpen(GAME), "show")}>
              SHOW OVERLAY
            </Button>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Current act" value={act ? `Act ${act.act}` : "—"} caption={act ? `${act.done} of ${act.total} steps` : "no progress yet"} />
        <StatTile label="Campaign" value={progress ? `${Math.floor(progress.fraction * 100)}%` : "—"} caption={progress ? `${progress.doneCount} done · ${progress.remainingCount} left` : "route steps"} />
        <StatTile
          label="Quest passive points"
          value={t.report ? `${t.report.passive.completed} / ${expected}` : expected}
          caption={t.report?.passive.fromPassives != null ? `/passives: ${t.report.passive.fromPassives}` : options.bandit === "kill" ? "Kill all bandits" : "helping a bandit"}
        />
        <StatTile label="Character" value={t.tracking.character?.name ?? "—"} caption={t.tracking.character ? `${t.tracking.character.class} · level ${t.tracking.character.level}` : "from your Client.txt"} />
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <Panel
          title="Now"
          actions={<ProvenanceTag provenance={{ kind: "user", source: "Your PoE 1 Client.txt (read-only) + your marks", at: null, note: "Read only while this page or the overlay is visible; nothing leaves this PC." }} />}
        >
          {t.tracking.error ? (
            <p className="flex items-start gap-2 text-xs text-warning">
              <Icon name="warning" size={13} className="mt-px shrink-0" />
              {t.tracking.error} — choose your Client.txt on the Location Atlas page.
            </p>
          ) : !progress || !objective ? (
            <p className="text-xs text-fg-muted">
              {t.tracking.characters && !t.tracking.character ? "No PoE 1 character in your Client.txt yet." : progress ? "You reached the end of the campaign route." : "Reading your Client.txt…"}
            </p>
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-fg">{name(objective.area)}</span>
                <PositionBadge position={progress.position} name={name} />
                {progress.position.kind !== "none" && progress.position.areaId !== objective.area && (
                  <span className="text-xs text-fg-muted">you are in {progress.position.kind === "outside" ? outsideName(progress.position.areaId, progress.position.areaName) : name(progress.position.areaId)}</span>
                )}
              </div>
              <ol className="mt-2 space-y-1 text-sm">
                {objective.steps.map((s, k) => (
                  <li key={s.id} className="flex items-start gap-2">
                    <span className={cn("w-4 shrink-0 text-right tabular-nums", k === 0 ? "text-accent" : "text-fg-subtle")}>{k + 1}.</span>
                    <StepText step={s} muted={k > 0} priority={t.priorities[s.index]} />
                  </li>
                ))}
              </ol>
              {objective.nextLocation && (
                <p className="mt-2 text-xs text-fg-muted">
                  NEXT LOCATION: <span className="text-fg">{name(objective.nextLocation)}</span>
                </p>
              )}
              {t.way && (
                <p className="mt-1 text-xs text-fg-muted">
                  <WayLine way={t.way} name={name} />
                </p>
              )}
              {atlasArea && (
                <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-xs text-fg-muted">
                  <span>
                    CURRENT AREA: <span className="text-fg">{name(atlasArea)}</span>
                  </span>
                  <Button size="sm" variant="secondary" icon="atlas" className="ml-auto" onClick={() => openAtlas(atlasArea)}>
                    OPEN LOCATION ATLAS
                  </Button>
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Overlay">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-fg-muted">
              {win?.visible ? "Shown on top of the game." : win?.open ? "Hidden." : "Not open."} It never takes focus from the game; drag its header to move it and resize it
              from its edges.
            </p>
            <Switch
              checked={!!win?.clickThrough}
              onChange={(on) => run(actTrackerSetClickThrough(GAME, on), "change")}
              label="Click-through"
              description="Clicks go through the overlay to the game. Its buttons stop working until you turn this off here."
            />
            <Switch checked={prefs.compact} onChange={(compact) => setPrefs({ ...prefs, compact })} label="Compact bar" description="One line: the current step and the next location." />
            <Switch checked={prefs.hints} onChange={(hints) => setPrefs({ ...prefs, hints })} label="Navigation hints" description="Community minimap hints (exile-leveling) under the objective." />
            <label className="flex items-center gap-3 text-xs text-fg-muted">
              <span className="w-24">Opacity</span>
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={Math.round(prefs.opacity * 100)}
                onChange={(e) => setPrefs({ ...prefs, opacity: Number(e.target.value) / 100 })}
                className="flex-1 accent-[var(--color-accent)]"
                aria-label="Overlay background opacity"
              />
              <span className="w-10 text-right tabular-nums">{Math.round(prefs.opacity * 100)}%</span>
            </label>
            <HotkeyField />
          </div>
        </Panel>
      </div>

      {t.times && (
        <div className="mb-5">
          <TimerPanel times={t.times} name={name} />
        </div>
      )}

      {t.report && (
        <div className="mb-5">
          <GuardianPanel report={t.report} trips={t.trips} name={name} canMark={!!t.tracking.character} onMark={(id, stage) => void t.markReward(id, stage)} />
        </div>
      )}

      <div className="mb-5 grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <Panel
          title="Guide"
          actions={
            <SegmentedControl
              size="sm"
              label="Act"
              value={String(shownAct)}
              onChange={(v) => setViewAct(Number(v))}
              segments={ACTS.map((a) => ({ value: String(a), label: String(a) }))}
            />
          }
        >
          {!dataset || !progress ? (
            <EmptyState icon="waypoint" loading title="Loading the guide" />
          ) : (
            <ActSteps
              steps={steps.filter((s) => s.act === shownAct)}
              progress={progress}
              name={name}
              onMark={(s, m) => void t.mark(s, m)}
              canMark={!!t.tracking.character}
              priorities={t.priorities}
              show={t.show}
              onAtlas={(area) => dataset?.areas.has(area) && openAtlas(area)}
              editor={editor}
            />
          )}
          {t.markError && <p className="mt-2 text-xs text-danger">{t.markError}</p>}
        </Panel>

        <div className="flex flex-col gap-5">
          <ProfilesPanel prefs={prefs} setPrefs={setPrefs} profiles={profiles} save={saveProfiles} stale={t.applied?.stale ?? 0} />

          <Panel title="Route options">
            {!prefsLoaded ? null : (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-fg-muted">
                  Guide: <span className="text-fg">{t.profile ? t.profile.name : `${FAST_ALL_PASSIVES.name} (built in)`}</span>.{" "}
                  {t.profile ? "These options are saved with your guide." : "These are your settings for the built-in guide; its steps stay as shipped."}
                </p>
                <Select<BanditChoice>
                  label="Bandits (Act 2)"
                  value={options.bandit}
                  onChange={(bandit) => setOptions({ ...options, bandit })}
                  options={BANDITS.map((b) => ({ value: b.id, label: `${b.label} — ${b.effect}` }))}
                />
                <Switch
                  checked={options.trials}
                  onChange={(trials) => setOptions({ ...options, trials })}
                  label="Trials of Ascendancy and Labyrinths"
                  description="The six trials per Labyrinth and the Normal, Cruel and Merciless runs."
                />
                <Switch
                  checked={options.leagueStartExtras}
                  onChange={(leagueStartExtras) => setOptions({ ...options, leagueStartExtras })}
                  label="League-start extras"
                  description="Extra quests and detours for a fresh character with no gear (flasks, The Den, Medicine Chest…)."
                />
                <Switch
                  checked={prefs.importantOnly}
                  onChange={(importantOnly) => setPrefs({ ...prefs, importantOnly })}
                  label="Show only important steps"
                  description="Hides skill-gem hand-ins, league-start extras and crafting recipes from the guide. They stay in the route; passive points, trials and bandits always show."
                />
                <Switch
                  checked={options.library}
                  onChange={(library) => setOptions({ ...options, library })}
                  label="The Library (Act 3)"
                  description="Siosa's gem vendor and A Fixture of Fate."
                />
                {characters.length > 1 && (
                  <Select<string>
                    label="Character"
                    value={prefs.characterId === null ? "follow" : String(prefs.characterId)}
                    onChange={(v) => setPrefs({ ...prefs, characterId: v === "follow" ? null : Number(v) })}
                    options={[{ value: "follow", label: "Follow the character I play" }, ...characters.map((c) => ({ value: String(c.id), label: `${c.name} · ${c.class} ${c.level}` }))]}
                  />
                )}
              </div>
            )}
          </Panel>

          <Panel title="Data">
            <ul className="flex flex-col gap-2.5 text-xs">
              <li>
                <p className="text-fg">
                  {ROUTE_META.source.name} <span className="text-fg-subtle">· {ROUTE_META.source.version} · {ROUTE_META.source.date}</span>
                </p>
                <p className="text-fg-muted">
                  Levelling route, {ROUTE_META.counts.steps} steps · {ROUTE_META.source.license} · community
                </p>
              </li>
              {SOURCES.filter((s) => s.id !== "exile-leveling").map((s) => (
                <li key={s.id}>
                  <p className="text-fg">{s.name}</p>
                  <p className="text-fg-muted">{s.kind === "game-output" ? "The game's own output" : s.kind === "game-data" ? "Game files" : "Community"}{s.license ? ` · ${s.license}` : ""}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-2xs text-fg-subtle">
              Client.txt shows the areas you enter — not kills, quest items or hand-ins. Steps the guide moves past are "passed" until you confirm them.
            </p>
            {t.issues.some((i) => i.severity === "error") && <p className="mt-2 text-2xs text-danger">The campaign data has problems: {t.issues[0]?.message}</p>}
          </Panel>
        </div>
      </div>

      <HistoryPanel runs={history.runs} error={history.error} currentId={t.tracking.character?.id ?? null} />
    </div>
  );
}

function ActSteps({
  steps,
  progress,
  name,
  onMark,
  canMark,
  priorities,
  show,
  onAtlas,
  editor,
}: {
  steps: ResolvedStep[];
  progress: NonNullable<ReturnType<typeof useTracker>["progress"]>;
  name: (id: string | null) => string;
  onMark: (s: ResolvedStep, m: "done" | "skipped" | "not-done" | null) => void;
  canMark: boolean;
  priorities: PrioritisedStep[];
  show: StepFilter;
  onAtlas?: (area: string) => void;
  editor: StepEditor;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [text, setText] = useState("");
  let lastArea: string | null = null;
  // While editing your guide, hidden steps stay listed (greyed) so they can be shown again.
  const shown = steps.filter((s) => s.to || show(s) || (editor.editable && editor.isHidden(s.id)));
  const hidden = steps.length - steps.filter((s) => s.to || show(s)).length;
  return (
    <ol className="flex flex-col">
      {hidden > 0 && (
        <li className="mb-1 text-2xs text-fg-subtle">
          {hidden} step{hidden === 1 ? "" : "s"} hidden{editor.editable ? " (greyed below)" : ""}.
        </li>
      )}
      {shown.map((s) => {
        const p = progress.steps[s.index]!;
        const header = s.area !== lastArea ? name(s.area) : null;
        lastArea = s.area;
        const behind = s.index < progress.cursor;
        return (
          <li key={s.id}>
            {header && (
              <div className="mt-3 mb-1 flex items-center gap-2 text-xs font-medium text-fg-muted first:mt-0">
                {header}
                {onAtlas && (
                  <button type="button" className="text-fg-disabled hover:text-accent" title={`Open ${header} in the Location Atlas`} onClick={() => onAtlas(s.area)}>
                    <Icon name="atlas" size={11} />
                  </button>
                )}
              </div>
            )}
            <div
              className={cn(
                "group flex items-start gap-2 rounded-md px-2 py-1 text-sm",
                p.status === "current" && "bg-accent-soft",
                editor.isHidden(s.id) && "opacity-45",
                editor.isCustom(s.id) && "border-l-2 border-accent/50",
              )}
            >
              <StatusDot status={p.status} reopened={p.reopened} />
              <div className="min-w-0 flex-1">
                <StepText step={s} muted={behind && !p.reopened} priority={priorities[s.index]} />
                {p.status === "current" && s.hints.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {s.hints.map((h, k) => (
                      <HintLine key={k} text={h.text} direction={h.direction} />
                    ))}
                  </ul>
                )}
              </div>
              {p.evidence && <span className="hidden shrink-0 text-2xs text-fg-subtle sm:inline">{EVIDENCE_LABEL[p.evidence]}</span>}
              {p.reopened && <Badge tone="warning">Not done</Badge>}
              {editor.editable && (
                <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <MarkButton onClick={() => editor.move(s, -1)} disabled={!editor.canMove(s, -1)} title="Move up within this visit">
                    {"\u2191"}
                  </MarkButton>
                  <MarkButton onClick={() => editor.move(s, 1)} disabled={!editor.canMove(s, 1)} title="Move down within this visit">
                    {"\u2193"}
                  </MarkButton>
                  {!s.to && <MarkButton onClick={() => editor.toggleHidden(s)}>{editor.isHidden(s.id) ? "Show" : "Hide"}</MarkButton>}
                  <MarkButton
                    onClick={() => {
                      setAdding(s.id);
                      setText("");
                    }}
                  >
                    + step
                  </MarkButton>
                  {editor.isCustom(s.id) && <MarkButton onClick={() => editor.removeCustom(s.id)}>Remove</MarkButton>}
                  <select
                    aria-label="Priority"
                    className="rounded border border-line bg-well px-1 py-0.5 text-2xs text-fg-muted"
                    value={editor.priorityOf(s.id) ?? ""}
                    onChange={(e) => editor.setPriority(s.id, (e.target.value || null) as StepPriority | null)}
                  >
                    <option value="">Priority: auto</option>
                    {(Object.keys(PRIORITY_LABEL) as StepPriority[]).map((k) => (
                      <option key={k} value={k}>
                        {PRIORITY_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </span>
              )}
              {canMark && !editor.editable && (
                <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  {p.evidence === "confirmed" || p.evidence === "skipped" || p.reopened ? (
                    <MarkButton onClick={() => onMark(s, null)}>Undo</MarkButton>
                  ) : (
                    <>
                      <MarkButton onClick={() => onMark(s, "done")}>Done</MarkButton>
                      {behind ? <MarkButton onClick={() => onMark(s, "not-done")}>Not done</MarkButton> : <MarkButton onClick={() => onMark(s, "skipped")}>Skip</MarkButton>}
                    </>
                  )}
                </span>
              )}
            </div>
            {adding === s.id && (
              <form
                className="ml-6 flex items-center gap-2 py-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  editor.addAfter(s, text);
                  setAdding(null);
                }}
              >
                <input
                  autoFocus
                  maxLength={200}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Your instruction, e.g. Buy a movement speed flask"
                  className="flex-1 rounded border border-line bg-well px-2 py-1 text-xs text-fg"
                  aria-label="New step"
                />
                <MarkButton onClick={() => setAdding(null)}>Cancel</MarkButton>
                <button type="submit" className="rounded border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-2xs text-accent-2">
                  Add
                </button>
              </form>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function MarkButton({ onClick, children, disabled, title }: { onClick: () => void; children: React.ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded border border-line px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-glass-hover hover:text-fg disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function StatusDot({ status, reopened }: { status: string; reopened: boolean }) {
  const cls = reopened
    ? "border-warning bg-warning-soft"
    : status === "done"
      ? "border-success bg-success"
      : status === "passed"
        ? "border-fg-subtle bg-transparent"
        : status === "skipped"
          ? "border-fg-disabled bg-fg-disabled"
          : status === "current"
            ? "border-accent bg-accent"
            : "border-line-strong bg-transparent";
  return <span className={cn("mt-[6px] size-2 shrink-0 rounded-full border", cls)} title={reopened ? "Not done" : status} />;
}

function HotkeyField() {
  const notify = useToast();
  const [value, setValue] = useState<string | null>(null);
  const [status, setStatus] = useState<HotkeyStatus | null>(null);
  useEffect(() => {
    getGameSetting<string>(GAME, "actTracker.hotkey")
      .then((v) => setValue(typeof v === "string" ? v : DEFAULT_HOTKEY))
      .catch(() => setValue(DEFAULT_HOTKEY));
    hotkeyStatus().then(setStatus).catch(() => {});
  }, []);
  if (value === null) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input size="sm" label="Show / hide hotkey" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Ctrl+Shift+T (empty = off)" />
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            actTrackerSetHotkey(GAME, value)
              .then(() => notify("success", "Hotkey saved", value.trim() ? `${value.trim()} works while Path of Exile is the active window.` : "The hotkey is off."))
              .catch((e) => notify("warning", "Couldn't use that hotkey", String(e)))
          }
        >
          Save
        </Button>
      </div>
      <p className="text-2xs text-fg-subtle">
        Registered only while Path of Exile 1 is the active window, so it never blocks other apps.
        {status?.trackerHotkey ? ` Active now: ${status.trackerHotkey}.` : ""}
      </p>
    </div>
  );
}
