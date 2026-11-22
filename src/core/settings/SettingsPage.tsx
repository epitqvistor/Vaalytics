import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useActiveGame } from "@/core/game-context/GameContext";
import { GAMES, type GameId } from "@/core/game-context/games";
import { getAppSetting, setAppSetting } from "@/core/ipc/commands";
import { isValidContact, useTradeContact } from "@/core/trade/hooks";
import { Badge, Button, Input, PageHeader, Panel, SegmentedControl, Select, Switch, type Segment } from "@/shared/components";
import { usePreferences } from "./PreferencesContext";
import { useGameSetting } from "./useGameSetting";

const DiagnosticsPanel = lazy(() => import("@/core/diagnostics/DiagnosticsPanel"));
// Dev-only: the component gallery is excluded from production bundles.
const DesignGallery = import.meta.env.DEV ? lazy(() => import("@/shared/design/DesignGallery")) : null;

type Tab = "general" | "game" | "diagnostics" | "design";

export default function SettingsPage() {
  const game = useActiveGame();
  const [tab, setTab] = useState<Tab>("general");
  const tabs: Segment<Tab>[] = [
    { value: "general", label: "General" },
    { value: "game", label: GAMES[game].shortTitle },
    { value: "diagnostics", label: "Diagnostics" },
    ...(DesignGallery ? [{ value: "design" as const, label: "Design system" }] : []),
  ];
  return (
    <div className="mx-auto max-w-[1360px]">
      <PageHeader title="Settings" actions={<SegmentedControl label="Settings section" value={tab} onChange={setTab} segments={tabs} />} />
      <Suspense fallback={null}>
        {/* Forms read best at a moderate width; the page edge stays aligned with other sections. */}
        {tab === "general" && (
          <div className="max-w-4xl">
            <GeneralSettings />
          </div>
        )}
        {tab === "game" && (
          <div className="max-w-4xl">
            <GameSettings key={game} />
          </div>
        )}
        {tab === "diagnostics" && <DiagnosticsPanel />}
        {tab === "design" && DesignGallery && <DesignGallery />}
      </Suspense>
    </div>
  );
}

function GeneralSettings() {
  const { prefs, setPref } = usePreferences();
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Appearance">
        <div className="flex flex-col gap-4">
          <Switch
            label="Reduce motion"
            description="Minimise animations. Vaalytics also follows the Windows animation setting automatically."
            checked={prefs.reduceMotion}
            onChange={(v) => setPref("reduceMotion", v)}
          />
          <Switch
            label="Show planned modules"
            description="List modules that aren't built yet in navigation, marked “Soon”. Their pages describe what they will do; they show no data."
            checked={prefs.showPlanned}
            onChange={(v) => setPref("showPlanned", v)}
          />
        </div>
      </Panel>
      <TradeSettings />
    </div>
  );
}

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

function TradeSettings() {
  const { contact, save } = useTradeContact();
  const [draft, setDraft] = useState<string | null>(null);
  const [restore, setRestore] = useState(true);
  useEffect(() => {
    getAppSetting<boolean>("priceCheck.restoreClipboard")
      .then((v) => isBool(v) && setRestore(v))
      .catch(() => {});
  }, []);
  const value = draft ?? contact ?? "";
  const valid = isValidContact(value);
  return (
    <Panel title="Price checking">
      <div className="flex flex-col gap-5">
        <Row
          label="Trade contact"
          description="Sent in the User-Agent of requests to pathofexile.com, as GGG asks of third-party tools. Required for live Trade searches."
        >
          <div className="flex w-72 items-start gap-2">
            <Input
              aria-label="Trade contact"
              placeholder="you@example.com"
              value={value}
              onChange={(e) => setDraft(e.target.value)}
              error={value && !valid ? "Email or https:// link" : undefined}
              containerClassName="flex-1"
            />
            <Button disabled={!valid || draft == null || draft === contact} onClick={() => save(value).then(() => setDraft(null))}>
              Save
            </Button>
          </div>
        </Row>
        <Switch
          label="Restore clipboard after a price check"
          description="Vaalytics copies the hovered item with the game's own Ctrl+C, reads it once, then puts your previous clipboard text back."
          checked={restore}
          onChange={(v) => {
            setRestore(v);
            void setAppSetting("priceCheck.restoreClipboard", v);
          }}
        />
      </div>
    </Panel>
  );
}

function HotkeyStatus() {
  const [status, setStatus] = useState<OverlayStatus | null>(null);
  useEffect(() => {
    invoke<OverlayStatus>("overlay_status")
      .then(setStatus)
      .catch(() => {});
    // Unlisten even when the page unmounts before listen() resolves.
    let un: (() => void) | undefined;
    let disposed = false;
    listen<OverlayStatus>("overlay:status", ({ payload }) => setStatus(payload))
      .then((u) => (disposed ? u() : (un = u)))
      .catch(() => {});
    return () => {
      disposed = true;
      un?.();
    };
  }, []);
  if (!status) return null;
  if (!status.supported) return <Badge tone="warning">{status.lastError ?? "Not supported on this system"}</Badge>;
  if (status.lastError) return <Badge tone="danger">{status.lastError}</Badge>;
  return status.foregroundGame ? (
    <Badge tone="success" dot>
      Active in {GAMES[status.foregroundGame].shortTitle} · {status.registeredHotkey}
    </Badge>
  ) : (
    <Badge tone="neutral" dot>
      Waiting for the game window
    </Badge>
  );
}

interface OverlayStatus {
  supported: boolean;
  foregroundGame: GameId | null;
  registeredHotkey: string | null;
  lastError: string | null;
}

const HOTKEYS = ["Ctrl+D", "Ctrl+Shift+D", "Alt+D", "Ctrl+Alt+D"] as const;
type Hotkey = (typeof HOTKEYS)[number];
const isHotkey = (v: unknown): v is Hotkey => typeof v === "string" && (HOTKEYS as readonly string[]).includes(v);
const isOpacity = (v: unknown): v is number => typeof v === "number" && v >= 0.5 && v <= 1;
const SORTS = ["price", "newest", "match"] as const;
type ListingSort = (typeof SORTS)[number];
const isSort = (v: unknown): v is ListingSort => typeof v === "string" && (SORTS as readonly string[]).includes(v);

/** Per-game settings: stored separately for PoE 1 and PoE 2. */
function GameSettings() {
  const game = useActiveGame();
  const [hotkey, setHotkey] = useGameSetting<Hotkey>(game, "priceCheck.hotkey", "Ctrl+D", isHotkey);
  const [opacity, setOpacity] = useGameSetting<number>(game, "overlay.opacity", 0.95, isOpacity);
  const [sort, setSort] = useGameSetting<ListingSort>(game, "priceCheck.defaultSort", "price", isSort);

  return (
    <Panel title={`Price checker · ${GAMES[game].title}`} actions={<HotkeyStatus />}>
      <div className="flex flex-col gap-5">
        <Row
          label="Price check shortcut"
          description="Active only while the game window is focused, so other apps keep their shortcuts. Changes apply the next time the game window is focused."
        >
          <Select
            label="Price check shortcut"
            hideLabel
            value={hotkey}
            onChange={setHotkey}
            options={HOTKEYS.map((h) => ({ value: h, label: h }))}
            className="w-44"
          />
        </Row>
        <Row label="Default listing sort" description="How listings are ordered when a price check opens.">
          <Select
            label="Default listing sort"
            hideLabel
            value={sort}
            onChange={setSort}
            options={[
              { value: "price", label: "Lowest price" },
              { value: "newest", label: "Newest" },
              { value: "match", label: "Best match" },
            ]}
            className="w-44"
          />
        </Row>
        <Row label="Overlay position" description="Open the overlay now to move and resize it. Vaalytics remembers where you leave it.">
          <Button icon="external" onClick={() => void invoke("overlay_preview", { game, text: null })}>
            Preview overlay
          </Button>
        </Row>
        <Row label="Overlay opacity" description="Background opacity of the price-check overlay.">
          <div className="flex w-44 items-center gap-3">
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              aria-label="Overlay opacity"
              className="h-1 flex-1 accent-accent"
            />
            <span className="tabular w-10 text-right text-xs text-fg-muted">{Math.round(opacity * 100)}%</span>
          </div>
        </Row>
      </div>
    </Panel>
  );
}

function Row({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-8">
      <div className="min-w-0">
        <div className="text-sm text-fg">{label}</div>
        <p className="mt-0.5 text-xs text-fg-muted">{description}</p>
      </div>
      {children}
    </div>
  );
}
