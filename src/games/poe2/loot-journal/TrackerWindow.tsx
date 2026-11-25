/**
 * Root of the Loot Tracker overlay window (`#loot-tracker`, PoE 2). Spec: docs/modules/loot-journal.md
 * A compact, always-on-top, frameless window that never takes focus from the game. It shows only what
 * Vaalytics stored: the open map (Session Intelligence or the user's own), captured items and their values.
 * Updates are event-driven (`loot:updated`, `session:updated`); the only timer is the on-screen clock, and
 * only while the window is visible and a clock is running. While hidden the body is unmounted.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  LOOT_HOTKEY_EVENT,
  LOOT_INVENTORY_EVENT,
  type LootInventoryEvent,
  LOOT_TRACKER_COLLAPSE_EVENT,
  LOOT_TRACKER_STATE_EVENT,
  SESSION_UPDATED_EVENT,
  lootMapControl,
  lootMapEdit,
  lootResetSession,
  lootSetConfig,
  lootTrackerState,
  lootTrackerSummary,
  lootTrackerWindow,
  type LootConfig,
  type LootHotkeyEvent,
  type LootItem,
  type LootMapRun,
  type LootTrackerSummary,
  type LootTrackerWindowState,
} from "@/core/ipc/commands";
import { DisplayCurrencyProvider, useMoney } from "@/core/market/DisplayCurrency";
import { LeagueProvider } from "@/core/market/LeagueContext";
import { PreferencesProvider, usePreferences } from "@/core/settings/PreferencesContext";
import { ErrorBoundary, IconButton } from "@/shared/components";
import { transition } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { useToolWindow } from "@/shared/window/ToolWindow";
import { POE2_CONFIG } from "../config";
import { useEvent, useLootConfig, useLootUpdates } from "./hooks";
import { displayName, mapDuration, mapName, quantityOf } from "./stats";
import { fmtClock, isLastListed, isRangeEstimate, isStale, ItemIcon } from "./ui";

const GAME = "poe2" as const;
const WINDOW_KEY = "lootTracker.window";
const BASE_WIDTH = 320;
const COLLAPSED_HEIGHT = 40;

export default function TrackerWindow() {
  useEffect(() => {
    document.documentElement.classList.add("overlay-window");
    document.documentElement.dataset.game = GAME;
    document.title = "Loot Tracker — Vaalytics";
  }, []);
  return (
    <PreferencesProvider>
      <MotionRoot>
        <ErrorBoundary>
          <LeagueProvider game={GAME}>
            <DisplayCurrencyProvider game={GAME} base={POE2_CONFIG.baseUnit} premium={POE2_CONFIG.premiumUnit}>
              <Overlay />
            </DisplayCurrencyProvider>
          </LeagueProvider>
        </ErrorBoundary>
      </MotionRoot>
    </PreferencesProvider>
  );
}

function MotionRoot({ children }: { children: ReactNode }) {
  const { prefs } = usePreferences();
  return (
    <MotionConfig reducedMotion={prefs.reduceMotion ? "always" : "user"} transition={transition.base}>
      {children}
    </MotionConfig>
  );
}

function useWindowState(): LootTrackerWindowState | null {
  const [state, setState] = useState<LootTrackerWindowState | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void lootTrackerState(GAME).then(setState).catch(() => {});
  }, []);
  useEvent<LootTrackerWindowState>(LOOT_TRACKER_STATE_EVENT, setState);
  return state;
}

function Overlay() {
  useToolWindow(WINDOW_KEY); // remembers position and size
  const win = useWindowState();
  const config = useLootConfig();
  const cfg = config.data;

  const save = useCallback(
    async (patch: Partial<LootConfig>) => {
      if (!cfg) return;
      const next = { ...cfg, ...patch };
      config.set(next);
      try {
        config.set(await lootSetConfig(GAME, next));
      } catch {
        config.set(cfg);
      }
    },
    [cfg, config],
  );

  // Collapsing shrinks the window to its header; expanding restores a usable height.
  const setCollapsed = useCallback(
    async (collapsed: boolean) => {
      void save({ overlayCollapsed: collapsed });
      if (!isTauri() || !cfg) return;
      const w = getCurrentWindow();
      const size = (await w.innerSize()).toLogical(await w.scaleFactor());
      const height = collapsed ? COLLAPSED_HEIGHT * cfg.overlayScale : Math.max(size.height, 360 * cfg.overlayScale);
      await w.setSize(new LogicalSize(size.width, height)).catch(() => {});
    },
    [cfg, save],
  );
  const collapsedRef = useRef(false);
  collapsedRef.current = !!cfg?.overlayCollapsed;
  useEvent(LOOT_TRACKER_COLLAPSE_EVENT, () => void setCollapsed(!collapsedRef.current));

  // Width follows the scale setting (height stays the user's).
  const scale = cfg?.overlayScale ?? 1;
  const ready = cfg !== null;
  useEffect(() => {
    if (!isTauri() || !ready) return;
    const w = getCurrentWindow();
    void (async () => {
      const size = (await w.innerSize()).toLogical(await w.scaleFactor());
      const want = Math.round(BASE_WIDTH * scale);
      if (Math.abs(size.width - want) > 2) await w.setSize(new LogicalSize(want, size.height)).catch(() => {});
    })();
  }, [scale, ready]);

  if (!cfg) return null;
  return (
    <div
      className="flex h-screen flex-col overflow-hidden rounded-lg border border-line-strong text-[13px] text-fg"
      style={{ backgroundColor: `rgb(15 16 19 / ${cfg.overlayOpacity})` }}
    >
      {/* Unmounted while hidden: nothing is read in the background. */}
      {win && !win.visible ? null : (
        <div className="flex min-h-0 flex-1 flex-col" style={{ zoom: scale }}>
          <Body cfg={cfg} clickThrough={!!win?.clickThrough} onCollapse={setCollapsed} onMode={(m) => void save({ overlayMode: m })} />
        </div>
      )}
    </div>
  );
}

/** Re-reads the summary on Loot Journal and Session Intelligence changes (coalesced). */
function useSummary(recent: number) {
  const [data, setData] = useState<LootTrackerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const load = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      lootTrackerSummary(GAME, recent)
        .then((d) => (setData(d), setError(null)))
        .catch((e) => setError(String(e)));
    }, 150);
  }, [recent]);
  useEffect(() => {
    load();
    return () => window.clearTimeout(timer.current);
  }, [load]);
  useLootUpdates(load);
  useEvent(SESSION_UPDATED_EVENT, load);
  return { data, error, reload: load };
}

/** Seconds now, ticking once a second only while something on screen is counting. */
function useClock(running: boolean) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    setNow(Date.now() / 1000);
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return now;
}

function Body({ cfg, clickThrough, onCollapse, onMode }: { cfg: LootConfig; clickThrough: boolean; onCollapse: (c: boolean) => void; onMode: (m: "compact" | "expanded") => void }) {
  const expanded = cfg.overlayMode === "expanded";
  const s = useSummary(expanded ? 40 : cfg.overlayRows);
  const map = s.data?.openMap ?? null;
  const shownMap = map ?? s.data?.lastMap ?? null;
  const now = useClock(!!(map?.runningSince || s.data?.sessionStartedAt));
  const money = useMoney();
  const fmt = (v: number) => money(v, { unit: POE2_CONFIG.baseUnit });
  const [toast, setToast] = useState<LootHotkeyEvent | null>(null);
  useEvent<LootHotkeyEvent>(LOOT_HOTKEY_EVENT, (e) => setToast(e));
  useEvent<LootInventoryEvent>(LOOT_INVENTORY_EVENT, (e) => setToast({ action: "screenshot", ok: e.kind !== "error", message: e.message }));
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);
  const [busy, setBusy] = useState(false);
  const control = async (action: "start" | "pause" | "resume" | "finish", id: number | null) => {
    setBusy(true);
    try {
      await lootMapControl(GAME, action, id);
    } catch (e) {
      setToast({ action: action === "start" ? "startMap" : "finishMap", ok: false, message: String(e) });
    } finally {
      setBusy(false);
      s.reload();
    }
  };

  const listening = !!s.data?.capture.listening;
  const sessionSecs = s.data?.sessionStartedAt ? now - s.data.sessionStartedAt : null;
  const mapSecs = map ? mapDuration(map, now) : null;

  const header = (
    <header data-tauri-drag-region className="flex h-10 shrink-0 items-center gap-2 border-b border-line pl-3 pr-1">
      <span data-tauri-drag-region className="text-[10px] font-bold tracking-[0.18em] text-accent-2">VAALYTICS</span>
      <span data-tauri-drag-region className="rounded-xs border border-line px-1 text-[9.5px] leading-4 font-semibold tracking-wider text-fg-muted">
        POE2
      </span>
      <span
        className={cn("size-1.5 shrink-0 rounded-full", listening ? "bg-success" : s.data?.capture.enabled ? "bg-accent" : "bg-fg-subtle")}
        title={listening ? "Capturing Ctrl+C copies (PoE 2 is focused)" : s.data?.capture.enabled ? "Capture on — waiting for PoE 2" : "Capture is off"}
      />
      <span data-tauri-drag-region className="min-w-0 flex-1 truncate text-xs text-fg-muted">
        {cfg.overlayCollapsed && map ? (
          <>
            <span className="tabular text-fg normal-case">{fmtClock(mapSecs ?? 0)}</span> · <span className="tabular text-fg normal-case">{fmt(map.value)}</span>
          </>
        ) : (
          (s.data?.areaName ?? (s.data?.sessionId ? "In game" : "No session"))
        )}
      </span>
      {clickThrough && (
        <span title="Click-through is on: clicks go to the game. Turn it off in Loot Journal → Settings." className="text-fg-subtle">
          <Icon name="cursor" size={13} />
        </span>
      )}
      {!cfg.overlayCollapsed && (
        <IconButton size="sm" icon={expanded ? "compact" : "fullscreen"} label={expanded ? "Compact view" : "Expanded view"} onClick={() => onMode(expanded ? "compact" : "expanded")} />
      )}
      <IconButton size="sm" icon={cfg.overlayCollapsed ? "chevronDown" : "chevronUp"} label={cfg.overlayCollapsed ? "Expand" : "Collapse"} onClick={() => onCollapse(!cfg.overlayCollapsed)} />
      <IconButton size="sm" icon="close" label="Hide (your hotkey or Loot Journal shows it again)" onClick={() => void lootTrackerWindow(GAME, "hide")} />
    </header>
  );

  if (cfg.overlayCollapsed) return header;
  if (s.error && !s.data)
    return (
      <>
        {header}
        <p className="p-3 text-xs text-warning">{s.error}</p>
      </>
    );

  return (
    <>
      {header}
      {/* Map timer */}
      <section className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] text-fg-subtle uppercase">
            {map ? `Map #${String(map.ordinal).padStart(3, "0")}` : "No map open"}
            {map && <SourceDot source={map.source} />}
            {map?.status === "paused" && <span className="text-warning">paused</span>}
          </p>
          <p className="truncate text-xs text-fg-muted">{map ? mapName(map) : s.data?.lastMap ? `Last: ${mapName(s.data.lastMap)}` : "Enter a map, or start one yourself"}</p>
        </div>
        <span className="tabular font-display text-[20px] leading-6 font-semibold text-fg">{mapSecs !== null ? fmtClock(mapSecs) : "--:--"}</span>
        <MapControls map={map} busy={busy} onControl={control} />
      </section>
      <section className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1 text-[10.5px] tracking-wide text-fg-subtle uppercase">
        <span title={s.data?.resetAt ? "Counting since your reset" : "Counting since the game session started"}>
          Session <span className="tabular text-fg-muted">{sessionSecs !== null ? fmtClock(sessionSecs) : "—"}</span>
        </span>
        <span>
          Maps <span className="tabular text-fg-muted">{s.data?.mapsFinished ?? 0}</span>
        </span>
        <ResetButton onReset={() => void lootResetSession(GAME, false).then(s.reload, () => {})} />
      </section>

      {/* Just finished: a short report to confirm (only what was captured / measured). */}
      {!map && s.data?.lastMap && !s.data.lastMap.userConfirmed && s.data.lastMap.endedAt !== null && now - s.data.lastMap.endedAt < 15 * 60 && (
        <MapCompleted m={s.data.lastMap} inventory={s.data.lastMapInventory} fmt={fmt} onConfirm={() => void lootMapEdit(GAME, s.data!.lastMap!.id, { confirmed: true }).then(s.reload, () => {})} />
      )}
      {/* Loot summary for the open (or last) map */}
      <section className="shrink-0 border-b border-line px-3 py-2">
        <p className="text-[10px] font-semibold tracking-[0.12em] text-fg-subtle uppercase">{map ? "Map loot value" : shownMap ? "Last map loot value" : "Session loot value"}</p>
        <div className="flex items-baseline justify-between gap-2">
          <span className="tabular font-display text-[18px] leading-6 font-semibold text-accent-2">{fmt(shownMap ? shownMap.value : (s.data?.sessionTotals.value ?? 0))}</span>
          <span className="truncate text-2xs text-fg-muted">
            {(() => {
              const t = shownMap ?? s.data?.sessionTotals;
              if (!t) return null;
              return `${t.items} captured · ×${t.quantity} · ${t.itemTypes} type${t.itemTypes === 1 ? "" : "s"}${t.unpriced ? ` · ${t.unpriced} unpriced` : ""}`;
            })()}
          </span>
        </div>
      </section>

      {/* Recent loot */}
      <section className="min-h-0 flex-1 overflow-y-auto">
        {!s.data ? null : s.data.recent.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-fg-subtle">Copy items in game with Ctrl+C — they appear here.</p>
        ) : (
          <ul>
            {s.data.recent.slice(0, expanded ? 40 : cfg.overlayRows).map((i) => (
              <LootRow key={i.id} item={i} fmt={fmt} expanded={expanded} />
            ))}
          </ul>
        )}
      </section>

      {toast && <p className={cn("shrink-0 border-t border-line px-3 py-1 text-2xs", toast.ok ? "text-success" : "text-warning")}>{toast.message}</p>}
      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[10.5px] tracking-wide text-fg-subtle uppercase">
        <span className="truncate">
          Map: <span className="tabular text-fg normal-case">{shownMap ? fmt(shownMap.value) : "—"}</span>
        </span>
        <span className="truncate">
          Session: <span className="tabular text-fg normal-case">{s.data?.sessionId ? fmt(s.data.sessionTotals.value) : "—"}</span>
        </span>
      </footer>
    </>
  );
}

function MapCompleted({ m, inventory, fmt, onConfirm }: { m: LootMapRun; inventory: [number, number, number] | null; fmt: (v: number) => string; onConfirm: () => void }) {
  const rows: [string, string][] = [
    ["Time", fmtClock(m.durationSecs)],
    ["Captured", `${m.items} item${m.items === 1 ? "" : "s"} · ${fmt(m.value)}`],
    ["Best", m.bestItemName ? `${m.bestItemName}${m.bestItemValue !== null ? ` · ${fmt(m.bestItemValue)}` : ""}` : "—"],
    ["Unpriced", String(m.unpriced)],
    ["Inventory", inventory ? `${fmt(inventory[1])} estimated${inventory[2] ? ` · ${inventory[2]} to check` : ""}` : "no snapshot"],
  ];
  const confidence = m.unpriced > 0 || (inventory !== null && inventory[2] > 0) ? "check" : "good";
  return (
    <section className="shrink-0 border-b border-accent/30 bg-accent-soft/30 px-3 py-2">
      <p className="flex items-center justify-between text-[10px] font-semibold tracking-[0.12em] text-accent-2 uppercase">
        Map completed · {mapName(m)}
        <span className={cn("normal-case tracking-normal", confidence === "good" ? "text-success" : "text-warning")}>{confidence === "good" ? "data complete" : "some data to check"}</span>
      </p>
      <dl className="mt-1 grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 text-[11px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-subtle">{k}</dt>
            <dd className="truncate text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-1.5 flex justify-end">
        <button type="button" onClick={onConfirm} className="rounded-xs border border-accent/40 px-2 text-[11px] leading-5 text-accent-2 hover:bg-accent-soft">
          Confirm map
        </button>
      </div>
    </section>
  );
}

/** Two clicks: "Reset" → "Sure?" (3 s). Starts the session counters now; nothing is deleted. */
function ResetButton({ onReset }: { onReset: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      title="Reset session: time, value, captures and maps count from now. Nothing is deleted."
      onClick={() => (armed ? (setArmed(false), onReset()) : setArmed(true))}
      className={cn("rounded-xs border px-1.5 text-[10px] leading-4 tracking-wide uppercase", armed ? "border-warning/50 text-warning" : "border-line text-fg-subtle hover:text-fg")}
    >
      {armed ? "Sure?" : "Reset"}
    </button>
  );
}

function SourceDot({ source }: { source: "auto" | "manual" }) {
  return (
    <span className={cn("rounded-xs border px-1 text-[9px] leading-3.5", source === "auto" ? "border-line text-fg-subtle" : "border-accent/40 text-accent-2")} title={source === "auto" ? "Detected from the game log (Session Intelligence)" : "Started by you"}>
      {source}
    </span>
  );
}

function MapControls({ map, busy, onControl }: { map: LootMapRun | null; busy: boolean; onControl: (a: "start" | "pause" | "resume" | "finish", id: number | null) => void }) {
  if (!map) return <IconButton size="sm" variant="secondary" icon="play" label="Start a map now (manual)" disabled={busy} onClick={() => onControl("start", null)} />;
  return (
    <span className="flex items-center gap-0.5">
      {map.source === "manual" &&
        (map.status === "paused" ? (
          <IconButton size="sm" icon="play" label="Resume" disabled={busy} onClick={() => onControl("resume", map.id)} />
        ) : (
          <IconButton size="sm" icon="pause" label="Pause" disabled={busy} onClick={() => onControl("pause", map.id)} />
        ))}
      <IconButton size="sm" icon="check" label="Finish map" disabled={busy} onClick={() => onControl("finish", map.id)} />
    </span>
  );
}

function LootRow({ item, fmt, expanded }: { item: LootItem; fmt: (v: number) => string; expanded: boolean }) {
  const priced = (item.valueStatus === "priced" || item.valueStatus === "manual") && item.valueTotal !== null;
  const warn = priced && (item.valueConfidence === "low" || isLastListed(item) || isStale(item));
  return (
    <li className="flex h-9 items-center gap-2 border-b border-line/60 px-3 last:border-b-0">
      <ItemIcon item={item} size={26} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-fg">
          {displayName(item)}
          {quantityOf(item) > 1 && <span className="tabular text-fg-muted"> ×{quantityOf(item)}</span>}
        </span>
        {expanded && item.captureAreaName && <span className="block truncate text-[10.5px] text-fg-subtle">{item.captureAreaName}</span>}
      </span>
      <span className={cn("tabular shrink-0 text-xs", priced ? (warn ? "text-warning/90" : "text-fg") : "text-fg-subtle")} title={item.valueNote ?? undefined}>
        {priced ? `${isRangeEstimate(item) ? "≥ " : ""}${fmt(item.valueTotal!)}` : item.valueStatus === "pending" ? "pricing…" : "no price"}
      </span>
    </li>
  );
}
