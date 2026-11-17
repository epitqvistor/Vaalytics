import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MotionConfig, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GAMES, type GameId } from "@/core/game-context/games";
import { setAppSetting } from "@/core/ipc/commands";
import { LeagueProvider, useLeague } from "@/core/market/LeagueContext";
import { PreferencesProvider, usePreferences } from "@/core/settings/PreferencesContext";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { IconButton, Spinner } from "@/shared/components";
import { transition } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { ItemCard } from "@/shared/item-renderer/ItemCard";
import { toDisplayItem } from "@/shared/item-renderer/adapt";
import { cn } from "@/shared/utilities/cn";
import { LeagueSelect } from "@/shared/views/market-ui";
import { PriceCheckSession } from "@/shared/views/price-check/PriceCheckSession";
import { GAME_MODULES } from "../gameModules";

interface CaptureEvent {
  game: GameId;
  text: string | null;
  error: string | null;
  preview?: boolean;
}

const isOpacity = (v: unknown): v is number => typeof v === "number" && v >= 0.5 && v <= 1;

/** Root of the always-on-top price-check overlay window. */
export default function OverlayApp() {
  const [capture, setCapture] = useState<CaptureEvent | null>(null);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    document.documentElement.classList.add("overlay-window");
    invoke<CaptureEvent | null>("overlay_take_pending")
      .then((c) => c && (setCapture(c), setSeq((s) => s + 1)))
      .catch(() => {});
    let unlisten: (() => void) | undefined;
    listen<CaptureEvent>("price-check:item", ({ payload }) => {
      setCapture(payload);
      setSeq((s) => s + 1);
    }).then((u) => (unlisten = u));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void getCurrentWindow().hide();
    window.addEventListener("keydown", onKey);
    return () => {
      unlisten?.();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useSaveBounds();

  return (
    <PreferencesProvider>
      <MotionRoot>
        {capture ? (
          <LeagueProvider game={capture.game}>
            <OverlayFrame key={seq} capture={capture} />
          </LeagueProvider>
        ) : (
          <div className="flex h-full items-center justify-center text-fg-subtle">
            <Spinner />
          </div>
        )}
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

function OverlayFrame({ capture }: { capture: CaptureEvent }) {
  const mod = GAME_MODULES[capture.game];
  const { league } = useLeague();
  const [opacity] = useGameSetting<number>(capture.game, "overlay.opacity", 0.95, isOpacity);
  const [clickThrough, setClickThrough] = useState(false);
  const [showItem, setShowItem] = useState(false);
  const parsed = useMemo(() => (capture.text ? mod.parse(capture.text) : null), [capture.text, mod]);

  const toggleClickThrough = () => {
    const next = !clickThrough;
    setClickThrough(next);
    // Re-enabled automatically the next time the hotkey opens the overlay.
    void getCurrentWindow().setIgnoreCursorEvents(next);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="flex h-full flex-col overflow-hidden rounded-xl border border-line-strong shadow-lg"
      style={{ backgroundColor: `rgb(22 24 28 / ${opacity})` }}
    >
      <header data-tauri-drag-region className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
        <img src="/vaalytics.svg" alt="" className="pointer-events-none size-4" />
        <span data-tauri-drag-region className="min-w-0 flex-1 truncate text-xs font-medium text-fg-muted">
          Price check · {GAMES[capture.game].shortTitle}
          {parsed?.ok && <span className="text-fg"> · {parsed.item.name ?? parsed.item.baseType}</span>}
        </span>
        {league && <LeagueSelect compact />}
        <IconButton
          icon="cursor"
          size="sm"
          label={clickThrough ? "Click-through on — press the hotkey again to interact" : "Click-through (let clicks pass to the game)"}
          onClick={toggleClickThrough}
          className={clickThrough ? "text-accent-2!" : undefined}
        />
        <IconButton icon="close" size="sm" label="Close (Esc)" onClick={() => void getCurrentWindow().hide()} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {capture.preview ? (
          <Notice icon="info" title="Overlay preview" body={capture.error ?? ""} />
        ) : capture.error ? (
          <Notice icon="warning" title="Couldn't read the item" body={capture.error} />
        ) : parsed && !parsed.ok ? (
          <Notice icon="error" title="Unrecognised item text" body={parsed.error} />
        ) : parsed?.ok && league ? (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setShowItem((s) => !s)}
              className="flex items-center gap-1.5 self-start text-xs text-fg-muted hover:text-fg"
              aria-expanded={showItem}
            >
              <Icon name={showItem ? "chevronDown" : "chevronRight"} size={12} />
              {showItem ? "Hide item" : "Show item"}
            </button>
            {showItem && <ItemCard item={toDisplayItem(parsed.item)} />}
            <PriceCheckSession item={parsed.item} league={league} config={mod.config} compact />
          </div>
        ) : (
          <div className={cn("flex h-full items-center justify-center text-fg-subtle")}>
            <Spinner />
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Notice({ icon, title, body }: { icon: "warning" | "error" | "info"; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Icon name={icon} size={20} className={icon === "error" ? "text-danger" : icon === "info" ? "text-info" : "text-warning"} />
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="max-w-sm text-xs text-fg-muted">{body}</p>
    </div>
  );
}

/** Persists overlay position/size (debounced) so it reopens where the user left it. */
function useSaveBounds() {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const w = getCurrentWindow();
    const save = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(async () => {
        try {
          const [pos, size] = await Promise.all([w.outerPosition(), w.outerSize()]);
          await setAppSetting("overlay.bounds", { x: pos.x, y: pos.y, width: size.width, height: size.height });
        } catch {
          /* window closing */
        }
      }, 500);
    };
    const subs = [w.onMoved(save), w.onResized(save)];
    return () => {
      window.clearTimeout(timer.current);
      subs.forEach((p) => p.then((u) => u()));
    };
  }, []);
}
