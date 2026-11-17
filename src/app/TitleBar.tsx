import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";

/**
 * Custom window chrome (the native frame is disabled in tauri.conf.json).
 * `data-tauri-drag-region` makes empty areas draggable; double-click toggles
 * maximise. Known limitation: Windows 11 Snap Layouts flyout does not appear
 * when hovering the custom maximise button.
 */
export function TitleBar({ children }: { children?: ReactNode }) {
  const native = isTauri();
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    if (!native) return;
    const win = getCurrentWindow();
    let disposed = false;
    const unlisten: (() => void)[] = [];
    const sync = () => win.isMaximized().then((m) => !disposed && setMaximized(m));
    sync();
    // Event-driven, no polling.
    win.onResized(sync).then((u) => (disposed ? u() : unlisten.push(u)));
    win.onFocusChanged(({ payload }) => setFocused(payload)).then((u) => (disposed ? u() : unlisten.push(u)));
    return () => {
      disposed = true;
      unlisten.forEach((u) => u());
    };
  }, [native]);

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "glass-nav relative z-40 flex h-titlebar shrink-0 items-center border-b border-line pl-3 transition-opacity",
        !focused && "[&>*]:opacity-60",
      )}
    >
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
        <img src="/vaalytics.svg" alt="" className="pointer-events-none size-4" />
        <span className="pointer-events-none text-xs font-semibold tracking-wide text-fg-muted">Vaalytics</span>
        {children}
      </div>
      {native && (
        <div className="flex h-full">
          <WindowButton icon="minimize" label="Minimize" onClick={() => getCurrentWindow().minimize()} />
          <WindowButton
            icon={maximized ? "restore" : "maximize"}
            label={maximized ? "Restore" : "Maximize"}
            onClick={() => getCurrentWindow().toggleMaximize()}
          />
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
        "flex h-full w-11.5 items-center justify-center text-fg-muted transition-colors duration-100",
        danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-glass-strong hover:text-fg",
      )}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}
