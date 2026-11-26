/** Deck Intelligence settings: tracking, screenshot recognition, prices, sessions, notifications, statistics, import. */
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import {
  DECKS_IMPORT_EVENT,
  type DeckConfig,
  type DeckImportStatus,
  type DivinationCardDb,
  type DeckBackupStatus,
  decksBackupNow,
  decksBackupStatus,
  decksImportCancel,
  decksOpenBackupDir,
  decksRestoreBackups,
  decksImportStart,
  decksImportStatus,
  decksSetPriceOverride,
} from "@/core/ipc/commands";
import { useLeague } from "@/core/market/LeagueContext";
import { Button, IconButton, Input, Kbd, Panel, ProvenanceTag, Select, Switch, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { formatRelative } from "@/shared/utilities/format";
import { isBuckets, type RangePreset } from "./analytics";
import { GAME, useDeckConfig } from "./hooks";
import { DEFAULT_PREFS, type DeckPrefs } from "./prefs";
import { CardPicker } from "./SessionTab";
import { ACQUISITION_LABEL, ACQUISITIONS, Money } from "./ui";

const errText = (e: unknown) => String(e).replace(/^Error: /, "");
const MODIFIERS = new Set(["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight"]);

/** "Ctrl+Shift+D" from a keydown (physical keys), null while only modifiers are held. */
export function shortcutFromKey(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  if (!e.code || MODIFIERS.has(e.code)) return null;
  const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.code.startsWith("Arrow") ? e.code.slice(5) : e.code;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  return [...mods, key].join("+");
}

function HotkeyRecorder({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const [recording, setRecording] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === "Escape") return setRecording(false);
      const k = shortcutFromKey(e);
      if (k) {
        onChange(k);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);
  return (
    <div className="flex items-center gap-2">
      {recording ? <span className="text-xs text-accent">Press a key combination… (Esc cancels)</span> : value ? <Kbd>{value}</Kbd> : <span className="text-xs text-fg-subtle">Off</span>}
      <Button size="sm" variant="secondary" onClick={() => setRecording((r) => !r)}>
        {recording ? "Cancel" : "Set shortcut"}
      </Button>
      {value && !recording && (
        <Button size="sm" variant="ghost" onClick={() => onChange("")}>
          Turn off
        </Button>
      )}
    </div>
  );
}

const REGIONS: { id: string; label: string; r: DeckConfig["region"] }[] = [
  { id: "full", label: "Whole game window", r: { x: 0, y: 0, w: 1, h: 1 } },
  { id: "center", label: "Centre (around your character)", r: { x: 0.15, y: 0.1, w: 0.7, h: 0.75 } },
  { id: "noui", label: "Without the bottom HUD", r: { x: 0, y: 0, w: 1, h: 0.82 } },
];

const pct = (v: number) => Math.round(v * 100);

export function SettingsTab({ prefs, setPrefs, cardDb, cardDbError, onRefreshCards, overrides, onOverridesChanged }: { prefs: DeckPrefs; setPrefs: (p: DeckPrefs) => void; cardDb: DivinationCardDb | null; cardDbError: string | null; onRefreshCards: () => void; overrides: ReadonlyMap<string, number>; onOverridesChanged: () => void }) {
  const notify = useToast();
  const { config, error, save } = useDeckConfig();
  const [draft, setDraft] = useState<DeckConfig | null>(null);
  useEffect(() => setDraft(config), [config]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [draft, config]);
  const names = useMemo(() => (cardDb?.cards ?? []).map((c) => c.name), [cardDb]);

  if (!draft) return <Panel>{error ? <p className="text-sm text-danger">{error}</p> : <p className="text-sm text-fg-muted">Loading settings…</p>}</Panel>;
  const set = (p: Partial<DeckConfig>) => setDraft({ ...draft, ...p });
  const regionId = REGIONS.find((r) => JSON.stringify(r.r) === JSON.stringify(draft.region))?.id ?? "custom";

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel
        title="Tracking"
        actions={
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty}
            onClick={() =>
              save(draft)
                .then(() => notify("success", "Deck Intelligence settings saved"))
                .catch((e) => notify("warning", "Couldn't save", errText(e)))
            }
          >
            Save
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Switch
            checked={draft.logTracking}
            onChange={(logTracking) => set({ logTracking })}
            label="Client.txt tracking"
            description="While a session runs, count every “Card drawn from the deck” line the game writes. Read-only; only new lines; nothing else from the log is stored."
          />
          <Switch
            checked={draft.groundTracking}
            onChange={(groundTracking) => set({ groundTracking })}
            label="Ground screenshots"
            description="Your shortcut takes one screenshot of the Path of Exile window and reads the card labels with Windows' built-in OCR. Never continuous."
          />
          <div>
            <div className="mb-1.5 text-xs text-fg-muted">Screenshot shortcut (registered only while Path of Exile is the active window)</div>
            <HotkeyRecorder value={draft.hotkey} onChange={(hotkey) => set({ hotkey })} />
          </div>
          <Switch checked={draft.keepScreenshots} onChange={(keepScreenshots) => set({ keepScreenshots })} label="Keep screenshots" description="Stores the captured area locally (PNG) so you can see it and retry recognition. Never uploaded." />
          {draft.logTracking && draft.groundTracking && (
            <p className="flex gap-2 rounded-md border border-line bg-bg-2 p-2.5 text-2xs leading-relaxed text-fg-muted">
              <Icon name="info" size={14} className="mt-px shrink-0 text-info" />
              With both on, a screenshot card that Client.txt also recorded in the duplicate window is put up for review instead of being counted twice.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Ground recognition">
        <div className="flex flex-col gap-4">
          <Select
            label="Capture area"
            value={regionId}
            onChange={(id) => id !== "custom" && set({ region: REGIONS.find((r) => r.id === id)!.r })}
            options={[...REGIONS.map((r) => ({ value: r.id, label: r.label })), { value: "custom", label: "Custom" }]}
          />
          <div className="grid grid-cols-4 gap-2">
            {(["x", "y", "w", "h"] as const).map((k) => (
              <Input
                key={k}
                size="sm"
                type="number"
                min={0}
                max={100}
                label={{ x: "Left %", y: "Top %", w: "Width %", h: "Height %" }[k]}
                value={pct(draft.region[k])}
                onChange={(e) => set({ region: { ...draft.region, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 } })}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input size="sm" type="number" min={60} max={100} label="Auto-confirm at %" value={pct(draft.thresholds.autoConfirm)} onChange={(e) => set({ thresholds: { ...draft.thresholds, autoConfirm: Number(e.target.value) / 100 } })} />
            <Input size="sm" type="number" min={40} max={100} label="Review at %" value={pct(draft.thresholds.review)} onChange={(e) => set({ thresholds: { ...draft.thresholds, review: Number(e.target.value) / 100 } })} />
            <Input size="sm" type="number" min={30} max={100} label="Unrecognized at %" value={pct(draft.thresholds.unrecognized)} onChange={(e) => set({ thresholds: { ...draft.thresholds, unrecognized: Number(e.target.value) / 100 } })} />
          </div>
          <p className="text-2xs leading-relaxed text-fg-subtle">
            Match score = how close the read text is to a card name (edit distance). At or above “auto-confirm” and unambiguous → confirmed; above “review” → you check it; above
            “unrecognized” → shown without a card; lower → other ground text, ignored.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input size="sm" type="number" min={0} max={3600} label="Duplicate window (s)" value={draft.dedupeSecs} onChange={(e) => set({ dedupeSecs: Math.max(0, Math.min(3600, Math.round(Number(e.target.value) || 0))) })} />
            <Input size="sm" type="number" min={0.2} max={20} step={0.1} label="Same spot within %" value={Math.round(draft.dedupeTolerance * 1000) / 10} onChange={(e) => set({ dedupeTolerance: (Number(e.target.value) || 2) / 100 })} />
          </div>
          <p className="text-2xs leading-relaxed text-fg-subtle">
            A card already seen at the same spot in a screenshot within the window is put up for review as a possible duplicate — never dropped silently. Copies at different spots count
            separately.
          </p>
        </div>
      </Panel>

      <PricesPanel names={names} overrides={overrides} onChanged={onOverridesChanged} />

      <Panel title="Sessions & notifications">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <Input size="sm" label="Default name" value={prefs.nameFormat} maxLength={120} hint="{date} and {n} are filled in" onChange={(e) => setPrefs({ ...prefs, nameFormat: e.target.value })} />
            <Select size="sm" label="Default acquisition" value={prefs.defaultAcquisition} onChange={(defaultAcquisition) => setPrefs({ ...prefs, defaultAcquisition })} options={ACQUISITIONS.map((a) => ({ value: a, label: ACQUISITION_LABEL[a] }))} />
          </div>
          <p className="text-2xs text-fg-subtle">Unfinished sessions are always saved as you go and continue after a restart. Profit is calculated in Chaos Orbs; “Show prices in” converts the display.</p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              size="sm"
              type="number"
              min={0}
              label="Notify for a card worth at least"
              suffix="c"
              value={prefs.notifyHighValue ?? ""}
              placeholder="Off"
              onChange={(e) => setPrefs({ ...prefs, notifyHighValue: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
            />
            <Input
              size="sm"
              type="number"
              min={0}
              label="Notify when profit passes"
              suffix="c"
              value={prefs.notifyProfitMilestone ?? ""}
              placeholder="Off"
              onChange={(e) => setPrefs({ ...prefs, notifyProfitMilestone: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
            />
          </div>
          <Switch checked={prefs.notifyReview} onChange={(notifyReview) => setPrefs({ ...prefs, notifyReview })} label="Recognition warnings" description="When a screenshot has entries to review or couldn't be read." />
          <Switch checked={prefs.notifyFinished} onChange={(notifyFinished) => setPrefs({ ...prefs, notifyFinished })} label="Session finished" />
        </div>
      </Panel>

      <Panel title="Statistics">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <Select
              size="sm"
              label="Default period"
              value={prefs.defaultRange}
              onChange={(defaultRange: RangePreset) => setPrefs({ ...prefs, defaultRange })}
              options={[
                { value: "7d", label: "Last 7 days" },
                { value: "30d", label: "Last 30 days" },
                { value: "90d", label: "Last 90 days" },
                { value: "all", label: "All time" },
              ]}
            />
            <Select
              size="sm"
              label="Default league"
              value={prefs.defaultLeague}
              onChange={(defaultLeague) => setPrefs({ ...prefs, defaultLeague })}
              options={[
                { value: "current", label: "Selected league" },
                { value: "all", label: "All leagues" },
              ]}
            />
          </div>
          <BucketsInput value={prefs.buckets} onChange={(buckets) => setPrefs({ ...prefs, buckets })} />
          <Switch checked={prefs.animateCharts} onChange={(animateCharts) => setPrefs({ ...prefs, animateCharts })} label="Chart animations" description="Short transitions when charts load or filters change. Reduced motion always wins." />
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setPrefs(DEFAULT_PREFS)}>
            Reset these preferences
          </Button>
        </div>
      </Panel>

      <div className="flex flex-col gap-4">
        <BackupPanel config={config} save={save} />
        <ImportPanel />
        <Panel title="Divination Card database">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {cardDb ? (
              <>
                <ProvenanceTag provenance={{ kind: "game-data", source: cardDb.source, at: cardDb.checkedAt * 1000 }} />
                <span className="text-fg">{cardDb.cards.length} cards</span>
                <span className="text-fg-subtle">checked {formatRelative(cardDb.checkedAt * 1000)}</span>
                {cardDb.staleError && <span className="text-warning">Update failed: {cardDb.staleError}</span>}
              </>
            ) : (
              <span className={cardDbError ? "text-danger" : "text-fg-muted"}>{cardDbError ?? "Loading…"}</span>
            )}
            <Button size="sm" variant="ghost" icon="refresh" className="ml-auto" onClick={onRefreshCards}>
              Check for updates
            </Button>
          </div>
          <p className="mt-2 text-2xs text-fg-subtle">Names, stack sizes and rewards from the game files (RePoE), re-checked at most daily. Artwork: the official card icon (no verified per-card art source yet).</p>
        </Panel>
      </div>
    </div>
  );
}

function BucketsInput({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [value]);
  const parsed = text
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  const ok = isBuckets(parsed);
  return (
    <Input
      size="sm"
      label="Value ranges (chaos, ascending)"
      value={text}
      error={ok ? undefined : "Up to 8 ascending numbers above 0"}
      hint={ok ? `Ranges: < ${parsed[0]}c … ${parsed[parsed.length - 1]}c+` : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => ok && onChange(parsed)}
    />
  );
}

function PricesPanel({ names, overrides, onChanged }: { names: readonly string[]; overrides: ReadonlyMap<string, number>; onChanged: () => void }) {
  const { league } = useLeague();
  const notify = useToast();
  const [card, setCard] = useState("");
  const [value, setValue] = useState("");
  const save = (c: string, v: number | null) =>
    league &&
    decksSetPriceOverride(GAME, league, c, v)
      .then(() => {
        onChanged();
        setCard("");
        setValue("");
      })
      .catch((e) => notify("warning", "Couldn't save the price", errText(e)));
  return (
    <Panel title="Prices">
      <p className="text-xs leading-relaxed text-fg-muted">
        Card prices come from poe.ninja through Vaalytics' Market Data engine for the selected league ({league ?? "—"}), cached and refreshed on its own schedule. A card without a
        price is shown as unknown — never as 0. Your own prices below replace the market price for that league and are labelled as yours.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CardPicker names={names} value={card} onChange={setCard} placeholder="Card" />
        <Input size="sm" type="number" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} suffix="c" containerClassName="w-28" aria-label="Your price" />
        <Button size="sm" variant="secondary" disabled={!league || !card.trim() || value === "" || Number(value) < 0} onClick={() => save(card.trim(), Number(value))}>
          Set price
        </Button>
      </div>
      {overrides.size > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line">
          {[...overrides].map(([c, v]) => (
            <li key={c} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className="flex-1 truncate text-fg">{c}</span>
              <Money value={v} />
              <IconButton size="sm" icon="close" label={`Remove your price for ${c}`} onClick={() => save(c, null)} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function BackupPanel({ config, save }: { config: DeckConfig | null; save: (c: DeckConfig) => Promise<DeckConfig> }) {
  const notify = useToast();
  const [st, setSt] = useState<DeckBackupStatus | null>(null);
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = () =>
    decksBackupStatus(GAME)
      .then(setSt)
      .catch(() => setSt(null));
  useEffect(() => {
    reload();
  }, [config]);
  useEffect(() => setDir(config?.backupDir ?? ""), [config]);
  if (!config) return null;
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      notify("warning", "Backup", errText(e));
    } finally {
      setBusy(false);
      reload();
    }
  };
  return (
    <Panel title="Backups">
      <p className="text-xs leading-relaxed text-fg-muted">
        Every session is also saved as a JSON file after each change, in a folder outside Vaalytics' own data — so uninstalling (even with “delete app data”) or a lost
        database doesn't lose your opening history. Deleted sessions are moved to <span className="text-fg">deleted\</span>, never removed. Screenshots aren't included.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        <Switch checked={config.backupEnabled} onChange={(backupEnabled) => run(async () => void (await save({ ...config, backupEnabled })))} label="Automatic backups" description="Recommended. Writes one small file per session." />
        <div className="flex flex-wrap items-end gap-2">
          <Input size="sm" label="Folder" value={dir} placeholder={st?.dir ?? "Documents\\Vaalytics\\Deck Intelligence"} onChange={(e) => setDir(e.target.value)} containerClassName="min-w-0 flex-1" />
          <Button size="sm" variant="secondary" disabled={busy || dir === config.backupDir} onClick={() => run(async () => void (await save({ ...config, backupDir: dir })))}>
            Use folder
          </Button>
          {config.backupDir && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => void (await save({ ...config, backupDir: "" })))}>
              Default
            </Button>
          )}
        </div>
        <div className="text-xs">
          {st ? (
            <>
              <span className="text-fg">{st.files} session files</span>
              <span className="text-fg-subtle"> in {st.dir}</span>
              {st.lastAt && <span className="text-fg-subtle"> · last backup {formatRelative(st.lastAt * 1000)}</span>}
              {st.lastError && <div className="mt-1 text-warning">Last backup failed: {st.lastError}</div>}
            </>
          ) : (
            <span className="text-fg-subtle">Backup status unavailable.</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon="external" disabled={busy} onClick={() => run(() => decksOpenBackupDir(GAME))}>
            Open folder
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="download"
            disabled={busy}
            onClick={() => run(async () => notify("success", "Backed up", `${await decksBackupNow(GAME)} sessions written`))}
          >
            Back up now
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="refresh"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await decksRestoreBackups(GAME);
                notify(
                  r.errors.length ? "warning" : "success",
                  r.sessionsAdded ? `Restored ${r.sessionsAdded} session${r.sessionsAdded === 1 ? "" : "s"}` : "Nothing to restore",
                  `${r.cardsAdded} cards · ${r.sessionsSkipped} already here${r.errors.length ? ` · ${r.errors.length} file(s) couldn't be read: ${r.errors[0]}` : ""}`,
                );
              })
            }
          >
            Restore from backups
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function ImportPanel() {
  const { league, leagues } = useLeague();
  const notify = useToast();
  const [target, setTarget] = useState<string>("");
  const [gap, setGap] = useState("60");
  const [st, setSt] = useState<DeckImportStatus | null>(null);
  useEffect(() => {
    decksImportStatus(GAME).then(setSt).catch(() => {});
    let un: (() => void) | undefined;
    let disposed = false;
    listen<DeckImportStatus>(DECKS_IMPORT_EVENT, ({ payload }) => setSt(payload))
      .then((u) => (disposed ? u() : (un = u)))
      .catch(() => {});
    return () => {
      disposed = true;
      un?.();
    };
  }, []);
  const chosen = target || league || "";
  return (
    <Panel title="Import from Client.txt">
      <p className="text-xs leading-relaxed text-fg-muted">
        Adds past “Card drawn from the deck” lines as finished sessions (split where no card was drawn for the gap below). Lines already recorded are skipped, so importing twice adds
        nothing. Cards that were never written to the log can't be recovered. Values use today's prices of the chosen league.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Select size="sm" label="League" value={chosen} onChange={setTarget} options={[{ value: "", label: "No league" }, ...leagues.map((l) => ({ value: l.name, label: l.displayName }))]} className="w-44" />
        <Input size="sm" type="number" min={0} max={1440} label="New session after (min)" value={gap} onChange={(e) => setGap(e.target.value)} containerClassName="w-40" />
        {st?.running ? (
          <Button size="sm" variant="danger" onClick={() => decksImportCancel(GAME)}>
            Cancel import
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon="download"
            onClick={() =>
              decksImportStart(GAME, { league: chosen || null, splitGapMinutes: Math.max(0, Math.min(1440, Math.round(Number(gap) || 0))) }).catch((e) => notify("warning", "Couldn't import", errText(e)))
            }
          >
            Choose Client.txt…
          </Button>
        )}
      </div>
      {st && (st.running || st.finished) && (
        <div className="mt-3 text-xs">
          <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
            <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${st.bytesTotal ? Math.min(100, (st.bytesDone / st.bytesTotal) * 100) : 0}%` }} />
          </div>
          <p className="mt-2 text-fg-muted">
            {st.running
              ? `Reading ${st.file ?? ""} — ${st.cardsFound} cards found`
              : st.error
                ? <span className="text-danger">{st.error}</span>
                : st.cancelled
                  ? "Import cancelled — nothing was added."
                  : `Done: ${st.cardsAdded} cards in ${st.sessionsCreated} new session${st.sessionsCreated === 1 ? "" : "s"}${st.duplicates ? `, ${st.duplicates} already recorded (skipped)` : ""}.`}
          </p>
        </div>
      )}
    </Panel>
  );
}
