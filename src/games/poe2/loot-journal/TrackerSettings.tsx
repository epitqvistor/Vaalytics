/** Loot Journal → Settings: the Loot Tracker overlay and the hotkeys. Persisted in Rust (`loot.config`). */
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  HOTKEY_STATUS_EVENT,
  hotkeyStatus,
  LOOT_TRACKER_STATE_EVENT,
  lootResetSession,
  lootSetConfig,
  lootTrackerSummary,
  lootTrackerSetClickThrough,
  lootTrackerState,
  lootTrackerWindow,
  type HotkeyStatus,
  type LootConfig,
  type LootHotkeyAction,
  type LootHotkeys,
  type LootTrackerWindowState,
} from "@/core/ipc/commands";
import { Button, Panel, SegmentedControl, Select, Switch, useToast } from "@/shared/components";
import { HotkeyField } from "./HotkeyField";
import { useEvent, useLootUpdates } from "./hooks";

const GAME = "poe2" as const;
const OPACITY = ["0.6", "0.7", "0.8", "0.9", "1"].map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)}%` }));
const SCALE = ["0.9", "1", "1.1", "1.25"].map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)}%` }));
const ROWS = ["5", "6", "7"].map((v) => ({ value: v, label: `${v} items` }));
const MODES = [
  { value: "compact", label: "Compact" },
  { value: "expanded", label: "Expanded" },
] as const;
const near = (v: number, opts: { value: string }[]) => opts.reduce((best, o) => (Math.abs(Number(o.value) - v) < Math.abs(Number(best.value) - v) ? o : best), opts[0]!).value;

export function useTrackerWindowState() {
  const [state, setState] = useState<LootTrackerWindowState | null>(null);
  useEffect(() => {
    if (isTauri()) void lootTrackerState(GAME).then(setState).catch(() => {});
  }, []);
  useEvent<LootTrackerWindowState>(LOOT_TRACKER_STATE_EVENT, setState);
  return state;
}

function useHotkeyStatus() {
  const [s, setS] = useState<HotkeyStatus | null>(null);
  useEffect(() => {
    if (isTauri()) void hotkeyStatus().then(setS).catch(() => {});
  }, []);
  useEvent<HotkeyStatus>(HOTKEY_STATUS_EVENT, setS);
  return s;
}

/** "Reset session": the overlay's SESSION counters start now; history stays. */
function SessionReset() {
  const notify = useToast();
  const [resetAt, setResetAt] = useState<number | null | undefined>(undefined);
  const load = () => void lootTrackerSummary(GAME, 1).then((s) => setResetAt(s.resetAt), () => setResetAt(null));
  useEffect(load, []);
  useLootUpdates(load);
  const run = (clear: boolean) =>
    lootResetSession(GAME, clear).then(
      (at) => (setResetAt(at), notify("success", clear ? "Following the game session again" : "Session reset — counters start now")),
      (e) => notify("warning", "Couldn't reset", String(e)),
    );
  return (
    <div className="well flex flex-wrap items-center gap-3 rounded-md px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">Session counters</p>
        <p className="text-2xs text-fg-subtle">
          {resetAt
            ? `Counting since your reset at ${new Date(resetAt * 1000).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} — across game restarts.`
            : "Counting since the current game session started (Session Intelligence)."}{" "}
          Resetting only restarts the overlay's time, value, captures and maps — nothing is deleted.
        </p>
      </div>
      <Button size="sm" variant="secondary" icon="refresh" onClick={() => void run(false)}>
        Reset session
      </Button>
      {resetAt && (
        <Button size="sm" variant="ghost" onClick={() => void run(true)}>
          Follow game session
        </Button>
      )}
    </div>
  );
}

export function TrackerSettings({ config, setConfig }: { config: LootConfig; setConfig: (c: LootConfig) => void }) {
  const notify = useToast();
  const win = useTrackerWindowState();
  const keys = useHotkeyStatus();
  const save = async (patch: Partial<LootConfig>) => {
    try {
      setConfig(await lootSetConfig(GAME, { ...config, ...patch }));
    } catch (e) {
      notify("warning", "Couldn't save the setting", String(e));
    }
  };
  const saveKey = async (action: LootHotkeyAction, key: string) => {
    // Errors (clashes, reserved keys) are shown by the field itself.
    setConfig(await lootSetConfig(GAME, { ...config, hotkeys: { ...config.hotkeys, [action]: key } as LootHotkeys }));
  };
  const status = (action: LootHotkeyAction) => {
    if (keys?.foregroundGame !== "poe2") return null;
    const k = keys.lootHotkeys.find((x) => x.action === action);
    return k ? { registered: k.registered, error: k.error } : null;
  };
  const field = (action: LootHotkeyAction, label: string, defaultValue: string, description?: string) => (
    <HotkeyField label={label} description={description} value={config.hotkeys[action]} defaultValue={defaultValue} status={status(action)} onSave={(k) => saveKey(action, k)} />
  );

  return (
    <>
      <Panel
        title="Loot Tracker overlay"
        actions={
          <Button size="sm" variant={win?.visible ? "secondary" : "primary"} icon={win?.visible ? "close" : "play"} onClick={() => void lootTrackerWindow(GAME, win?.visible ? "hide" : "open").catch((e) => notify("warning", "Couldn't open the overlay", String(e)))}>
            {win?.visible ? "Hide overlay" : "Show overlay"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-2xs leading-relaxed text-fg-subtle">
            A small window above the game with the map timer, the map's captured value and your latest captures. It never takes focus from the game; drag it by its top bar (its
            position and size are remembered). Works while Vaalytics is minimised. Use “Windowed fullscreen” in Path of Exile 2 — an exclusive fullscreen game can cover any overlay.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Select label="Background" value={near(config.overlayOpacity, OPACITY)} onChange={(v) => save({ overlayOpacity: Number(v) })} options={OPACITY} className="w-28" />
            <Select label="Size" value={near(config.overlayScale, SCALE)} onChange={(v) => save({ overlayScale: Number(v) })} options={SCALE} className="w-28" />
            <Select label="Compact list" value={String(config.overlayRows)} onChange={(v) => save({ overlayRows: Number(v) })} options={ROWS} className="w-32" />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Layout</span>
              <SegmentedControl label="Layout" size="sm" value={config.overlayMode} onChange={(v) => save({ overlayMode: v })} segments={MODES} />
            </div>
          </div>
          <SessionReset />
          <Switch label="Always on top" description="Keep the overlay above the game window." checked={config.overlayAlwaysOnTop} onChange={(v) => save({ overlayAlwaysOnTop: v })} />
          <Switch
            label="Click-through"
            description="Clicks pass through the overlay to the game (its buttons stop working). Turn it off here."
            checked={!!win?.clickThrough}
            onChange={(v) => void lootTrackerSetClickThrough(GAME, v).catch((e) => notify("warning", "Couldn't change click-through", String(e)))}
          />
        </div>
      </Panel>

      <Panel title="Hotkeys">
        <div className="flex flex-col gap-4">
          <p className="text-2xs leading-relaxed text-fg-subtle">
            Registered only while a Path of Exile 2 window is active, so they never block these keys in other programs. Item capture (Ctrl+C) doesn't need a hotkey and isn't affected by these.
            Keys without Ctrl/Alt, Escape and Ctrl+C/V are refused because the game needs them.
          </p>
          {field("toggleOverlay", "Show / hide the overlay", "Ctrl+Shift+L")}
          {field("collapseOverlay", "Collapse / expand the overlay", "")}
          {field("startMap", "Start a map (manual)", "", "Starts your own map record; useful when the game log isn't available.")}
          {field("finishMap", "Finish the map", "", "Finishes the open map — yours, or a detected one you want to end early.")}
          {field("screenshot", "Inventory screenshot", "", "One screenshot of your open inventory per press; reviewed on the Inventory tab.")}
        </div>
      </Panel>
    </>
  );
}
