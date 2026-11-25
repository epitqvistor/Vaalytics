import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MotionConfig, motion } from "motion/react";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GAMES, type GameId } from "@/core/game-context/games";
import { setAppSetting } from "@/core/ipc/commands";
import { DisplayCurrencyProvider } from "@/core/market/DisplayCurrency";
import { LeagueProvider, useLeague } from "@/core/market/LeagueContext";
import { PreferencesProvider, usePreferences } from "@/core/settings/PreferencesContext";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { IconButton, Spinner } from "@/shared/components";
import { transition } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { matchesShortcut } from "@/shared/utilities/shortcut";
import { LeagueSelect } from "@/shared/views/market-ui";
import { PriceCheckSession } from "@/shared/views/price-check/PriceCheckSession";
import { specialFor } from "@/shared/views/price-check/special";
import { GAME_MODULES } from "../gameModules";

interface CaptureEvent {
  game: GameId;
  text: string | null;
  error: string | null;
  preview?: boolean;
}

const isOpacity = (v: unknown): v is number => typeof v === "number" && v >= 0.5 && v <= 1;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isShortcut = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 32;

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
            <DisplayCurrencyProvider game={capture.game} base={GAME_MODULES[capture.game].config.baseUnit} premium={GAME_MODULES[capture.game].config.premiumUnit}>
              <OverlayFrame key={seq} capture={capture} />
            </DisplayCurrencyProvider>
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
  const parsed = useMemo(() => (capture.text ? mod.parse(capture.text) : null), [capture.text, mod]);
  const special = parsed?.ok ? specialFor(mod.special, parsed.item) : null;
  const [hotkey] = useGameSetting<string>(capture.game, "priceCheck.hotkey", "Ctrl+D", isShortcut);
  // Locked: stays open until closed. Quick: closes as soon as focus goes back to the game.
  const [locked, setLocked] = useGameSetting<boolean>(capture.game, "priceCheck.overlayLocked", true, isBool);

  // Quick mode is enforced by the host: it hides the overlay when the game window returns to the
  // foreground (the webview's own focus events are unreliable while the window is being shown).

  // Pressing the price-check hotkey again closes the overlay. While the overlay has focus the game
  // isn't in the foreground, so the global hotkey is unregistered and the key arrives here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !matchesShortcut(e, hotkey)) return;
      e.preventDefault();
      void getCurrentWindow().hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

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
          Price check · <span className="text-fg">{GAMES[capture.game].shortTitle}</span>
          {parsed?.ok && <span className="text-fg-subtle"> · {parsed.item.itemClass}</span>}
        </span>
        {league && <LeagueSelect compact />}
        <IconButton
          icon="pin"
          size="sm"
          label={locked ? "Locked — stays open (click for Quick: closes when you click back into the game)" : "Quick — closes when you click back into the game (click to lock)"}
          aria-pressed={locked}
          onClick={() => setLocked(!locked)}
          className={locked ? "text-accent!" : undefined}
        />
        <IconButton
          icon="cursor"
          size="sm"
          label={clickThrough ? "Click-through on — price-check an item to interact again" : "Click-through (let clicks pass to the game)"}
          onClick={toggleClickThrough}
          className={clickThrough ? "text-accent-2!" : undefined}
        />
        <IconButton icon="close" size="sm" label={`Close (Esc or ${hotkey})`} onClick={() => void getCurrentWindow().hide()} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {capture.preview ? (
          <Notice icon="info" title="Overlay preview" body={capture.error ?? ""} />
        ) : capture.error ? (
          <Notice icon="warning" title="Couldn't read the item" body={capture.error} />
        ) : parsed && !parsed.ok ? (
          <Notice icon="error" title="Unrecognised item text" body={parsed.error} />
        ) : parsed?.ok && league && special ? (
          <Suspense fallback={<Spinner />}>
            <special.Component item={parsed.item} league={league} compact />
          </Suspense>
        ) : parsed?.ok && league ? (
          <PriceCheckSession item={parsed.item} league={league} config={mod.config} compact />
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
