/**
 * Chrome for Vaalytics tool windows (separate Tauri windows such as the Location
 * Atlas): a draggable bar with the window's own controls (always on top, compact,
 * fullscreen, minimise / maximise / close) and a hook that remembers bounds and
 * always-on-top in one app setting. Game-agnostic; event-driven, no polling.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getAppSetting, setAppSetting, type JsonValue } from "@/core/ipc/commands";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";

export interface ToolWindowState {
  alwaysOnTop: boolean;
  fullscreen: boolean;
  maximized: boolean;
  setAlwaysOnTop: (on: boolean) => void;
  setFullscreen: (on: boolean) => void;
}

type Stored = { x?: number; y?: number; width?: number; height?: number; alwaysOnTop?: boolean };
const isStored = (v: unknown): v is Stored => !!v && typeof v === "object" && !Array.isArray(v);

/** Saves position/size (debounced) and always-on-top under `settingKey`; the Rust side restores them. */
export function useToolWindow(settingKey: string): ToolWindowState {
  const native = isTauri();
  const [alwaysOnTop, setTop] = useState(false);
  const [fullscreen, setFull] = useState(false);
  const [maximized, setMax] = useState(false);
  const stored = useRef<Stored>({});
  const timer = useRef<number | undefined>(undefined);

  const write = useCallback(
    (patch: Stored) => {
      stored.current = { ...stored.current, ...patch };
      void setAppSetting(settingKey, stored.current as JsonValue).catch(() => {});
    },
    [settingKey],
  );

  useEffect(() => {
    if (!native) return;
    const w = getCurrentWindow();
    let disposed = false;
    const unlisten: (() => void)[] = [];
    void getAppSetting(settingKey).then((v) => {
      if (disposed || !isStored(v)) return;
      stored.current = v;
      setTop(!!v.alwaysOnTop);
    });
    const sync = () => {
      void w.isMaximized().then((m) => !disposed && setMax(m));
      void w.isFullscreen().then((f) => !disposed && setFull(f));
    };
    sync();
    const save = () => {
      sync();
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        try {
          // Keep the normal bounds: Windows reports a minimised window at -32000 with a 160×28 size.
          if ((await w.isMinimized()) || (await w.isFullscreen()) || (await w.isMaximized())) return;
          const [pos, size] = await Promise.all([w.outerPosition(), w.outerSize()]);
          if (pos.x <= -30000 || pos.y <= -30000 || size.width < 300 || size.height < 240) return;
          write({ x: pos.x, y: pos.y, width: size.width, height: size.height });
        } catch {
          /* window closing */
        }
      }, 500);
    };
    w.onMoved(save).then((u) => (disposed ? u() : unlisten.push(u)));
    w.onResized(save).then((u) => (disposed ? u() : unlisten.push(u)));
    return () => {
      disposed = true;
      window.clearTimeout(timer.current);
      unlisten.forEach((u) => u());
    };
  }, [native, settingKey, write]);

  const setAlwaysOnTop = useCallback(
    (on: boolean) => {
      setTop(on);
      write({ alwaysOnTop: on });
      if (native) void getCurrentWindow().setAlwaysOnTop(on);
    },
    [native, write],
  );
  const setFullscreen = useCallback(
    (on: boolean) => {
      setFull(on);
      if (native) void getCurrentWindow().setFullscreen(on);
    },
    [native],
  );
  return { alwaysOnTop, fullscreen, maximized, setAlwaysOnTop, setFullscreen };
}

/** Toggle in the bar: pressed state is shown by colour and `aria-pressed`, not colour alone (icon + title). */
export function BarToggle({ icon, label, pressed, onClick }: { icon: IconName; label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={`${label}${pressed ? " (on)" : ""}`}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md transition-colors duration-150",
        pressed ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-glass-strong hover:text-fg",
      )}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** The window's own title bar. `children` go between the title and the window buttons. */
export function ToolWindowBar({ title, children, state }: { title: ReactNode; children?: ReactNode; state: ToolWindowState }) {
  const native = isTauri();
  return (
    <header data-tauri-drag-region className="glass-nav relative z-40 flex h-11 shrink-0 items-center gap-2 border-b border-line pl-3">
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
        <img src="/vaalytics.svg" alt="" className="pointer-events-none size-4" />
        <span className="pointer-events-none truncate text-xs font-semibold tracking-wide text-fg">{title}</span>
      </div>
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
        {children}
      </div>
      {native && (
        <div className="flex h-full items-center">
          <div className="mr-1 flex items-center gap-0.5">
            <BarToggle icon="pin" label="Always on top" pressed={state.alwaysOnTop} onClick={() => state.setAlwaysOnTop(!state.alwaysOnTop)} />
            <BarToggle icon="fullscreen" label="Full screen" pressed={state.fullscreen} onClick={() => state.setFullscreen(!state.fullscreen)} />
          </div>
          <WindowButton icon="minimize" label="Minimize" onClick={() => getCurrentWindow().minimize()} />
          <WindowButton icon={state.maximized ? "restore" : "maximize"} label={state.maximized ? "Restore" : "Maximize"} onClick={() => getCurrentWindow().toggleMaximize()} />
          <WindowButton icon="close" label="Close" danger onClick={() => getCurrentWindow().close()} />
        </div>
      )}
    </header>
  );
}

function WindowButton({ icon, label, onClick, danger }: { icon: IconName; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-full w-11 items-center justify-center text-fg-muted transition-colors duration-100",
        danger ? "hover:bg-window-close hover:text-white" : "hover:bg-glass-strong hover:text-fg",
      )}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}
