/**
 * Root of the Location Atlas window (`#atlas`, PoE 1). Spec: docs/modules/location-atlas.md
 * One instance (Rust focuses it when opened again); `atlas:select` moves it to an area.
 */
import { listen } from "@tauri-apps/api/event";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PreferencesProvider,
  usePreferences,
} from "@/core/settings/PreferencesContext";
import { useGameSetting } from "@/core/settings/useGameSetting";
import {
  Button,
  ErrorBoundary,
  Input,
  Spinner,
  ToastProvider,
} from "@/shared/components";
import { transition } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import {
  BarToggle,
  ToolWindowBar,
  useToolWindow,
} from "@/shared/window/ToolWindow";
import {
  ActMapView,
  DEFAULT_LAYERS,
  MAP_LAYERS,
  type MapLayer,
} from "./ActMapView";
import { ActTrackerAreaGuide } from "@/games/poe1/act-tracker/AreaGuideSection";
import { AreaDetail } from "./AreaDetail";
import {
  DEFAULT_PREFS,
  isAtlasPrefs,
  PREFS_KEY,
  pushRecent,
  type AtlasPrefs,
} from "./browser";
import { useAtlasDataset, useAtlasTracking } from "./hooks";
import { LocationBrowser } from "./LocationBrowser";
import { RoutePanel, type RouteOptions } from "./RoutePanel";
import { planRoute } from "./routes";

const GAME = "poe1" as const;
const AREA_PARAM = /[?&]area=([12]_\d+_[A-Za-z0-9_]+)/;

export default function AtlasWindow() {
  useEffect(() => {
    document.documentElement.dataset.game = GAME;
    document.title = "Location Atlas — Vaalytics";
  }, []);
  return (
    <PreferencesProvider>
      <MotionRoot>
        <ToastProvider>
          <ErrorBoundary>
            <Atlas />
          </ErrorBoundary>
        </ToastProvider>
      </MotionRoot>
    </PreferencesProvider>
  );
}

function MotionRoot({ children }: { children: React.ReactNode }) {
  const { prefs } = usePreferences();
  return (
    <MotionConfig
      reducedMotion={prefs.reduceMotion ? "always" : "user"}
      transition={transition.base}
    >
      {children}
    </MotionConfig>
  );
}

function Atlas() {
  const win = useToolWindow("atlas.window");
  const [prefs, setPrefs, loaded] = useGameSetting(
    GAME,
    PREFS_KEY,
    DEFAULT_PREFS,
    isAtlasPrefs,
  );
  const { dataset, areas, issues } = useAtlasDataset();
  const tracking = useAtlasTracking(areas);
  const [query, setQuery] = useState("");
  /** The open route planner; not saved — a route is planned for now. */
  const [routeOpts, setRouteOpts] = useState<RouteOptions | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const hintCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of dataset?.acts.flatMap((a) => a.hints) ?? [])
      m.set(h.area, (m.get(h.area) ?? 0) + 1);
    return m;
  }, [dataset]);
  const allAreas = useMemo(() => [...areas.values()], [areas]);
  const hints = useMemo(
    () => dataset?.acts.flatMap((a) => a.hints) ?? [],
    [dataset],
  );

  /** Shows an area; by hand (`manual`) stops following the log. */
  const show = useCallback(
    (id: string, manual: boolean) => {
      const a = areas.get(id);
      if (!a) return;
      const p = prefsRef.current;
      if (p.selected === id && p.act === a.act && (!manual || !p.follow))
        return;
      setPrefs({
        ...p,
        selected: id,
        act: a.act,
        recent: pushRecent(p.recent, id),
        follow: manual ? false : p.follow,
      });
    },
    [areas, setPrefs],
  );

  // Opened on an area (`#atlas?area=…`) or moved there later (`atlas:select`).
  useEffect(() => {
    if (!loaded || !areas.size) return;
    const m = window.location.hash.match(AREA_PARAM);
    if (m) show(m[1]!, true);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<string>("atlas:select", ({ payload }) => show(payload, true))
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loaded, areas, show]);

  // Follow the area you are in.
  const here =
    tracking.location?.location.kind === "in-area"
      ? tracking.location.location.area.id
      : null;
  useEffect(() => {
    if (loaded && prefs.follow && here) show(here, false);
  }, [loaded, prefs.follow, here, show]);

  const selected = prefs.selected ? (areas.get(prefs.selected) ?? null) : null;
  const visited = tracking.location?.visited ?? EMPTY;
  const errors = issues.filter((i) => i.severity === "error");
  const plan = useMemo(
    () =>
      routeOpts &&
      planRoute({
        areas,
        from: routeOpts.from ?? here,
        to: routeOpts.to,
        target: routeOpts.target,
        waypoints: routeOpts.waypoints,
        visited,
      }),
    [routeOpts, areas, here, visited],
  );
  const openRoute = () =>
    setRouteOpts({
      from: here ? null : (selected?.id ?? null),
      to: selected?.id ?? null,
      target: "area",
      // Waypoint unlocks are only known when the log has a character.
      waypoints: tracking.character ? "unlocked" : "none",
    });
  const layers = (prefs.layers?.filter((l): l is MapLayer =>
    MAP_LAYERS.some((m) => m.id === l),
  ) ?? DEFAULT_LAYERS) as MapLayer[];

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <ToolWindowBar title="Location Atlas" state={win}>
        <span
          data-tauri-drag-region
          className="pointer-events-none hidden min-w-0 truncate text-xs text-fg-muted sm:inline"
        >
          {selected ? `Act ${selected.act} · ${selected.name}` : ""}
        </span>
        <div className="ml-auto w-56 max-w-[40%]">
          <Input
            size="sm"
            icon="search"
            placeholder="Search areas"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search areas"
          />
        </div>
        <BarToggle
          icon="compact"
          label="Compact mode"
          pressed={prefs.compact}
          onClick={() => setPrefs({ ...prefs, compact: !prefs.compact })}
        />
      </ToolWindowBar>

      {!dataset || !loaded ? (
        <div className="flex flex-1 items-center justify-center text-fg-subtle">
          <Spinner />
        </div>
      ) : (
        <div
          className={cn(
            "grid min-h-0 flex-1",
            prefs.compact && !query
              ? "grid-cols-1"
              : "grid-cols-[minmax(240px,300px)_minmax(0,1fr)]",
          )}
        >
          {(!prefs.compact || query) && (
            <aside className="min-h-0 border-r border-line bg-bg-2">
              <LocationBrowser
                areas={allAreas}
                acts={dataset.meta.acts}
                act={prefs.act}
                query={query}
                filter={prefs.filter}
                selected={prefs.selected}
                current={here}
                visited={visited}
                favorites={prefs.favorites}
                recent={prefs.recent}
                hintCount={hintCount}
                onAct={(act) => setPrefs({ ...prefs, act })}
                onFilter={(filter) => setPrefs({ ...prefs, filter })}
                onSelect={(id) => {
                  setQuery("");
                  show(id, true);
                }}
              />
            </aside>
          )}
          <main
            className={cn(
              "grid min-h-0",
              prefs.compact
                ? "grid-cols-1"
                : "grid-cols-[minmax(0,1fr)_minmax(300px,380px)]",
            )}
          >
            {!prefs.compact && (
              <section className="relative min-h-0 border-r border-line bg-bg">
                <ActMapView
                  act={prefs.act}
                  areas={areas}
                  selected={prefs.selected}
                  current={here}
                  visited={visited}
                  hintCount={hintCount}
                  layers={layers}
                  route={plan?.ok ? plan.route : null}
                  onLayers={(l) => setPrefs({ ...prefs, layers: l })}
                  onSelect={(id) => show(id, true)}
                />
              </section>
            )}
            <div className="min-h-0 overflow-y-auto p-5">
              {errors.length > 0 && (
                <p className="mb-4 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-xs text-danger">
                  Part of the campaign data couldn't be loaded ({errors.length}{" "}
                  problem{errors.length === 1 ? "" : "s"}): {errors[0]!.where} —{" "}
                  {errors[0]!.message}
                </p>
              )}
              {routeOpts && plan ? (
                <RoutePanel
                  options={routeOpts}
                  plan={plan}
                  areas={areas}
                  here={here}
                  selected={selected}
                  onChange={setRouteOpts}
                  onClose={() => setRouteOpts(null)}
                  onSelect={(id) => show(id, true)}
                />
              ) : (
                <div className="mb-4 flex justify-end">
                  <Button size="sm" icon="route" onClick={openRoute}>
                    {selected && selected.id !== here
                      ? `Route to ${selected.name}`
                      : "Plan a route"}
                  </Button>
                </div>
              )}
              {selected ? (
                <>
                  <AreaDetail
                    key={selected.id}
                    area={selected}
                    areas={areas}
                    hints={hints}
                    here={selected.id === here}
                    visited={visited.has(selected.id)}
                    favorite={prefs.favorites.includes(selected.id)}
                    compact={prefs.compact}
                    onSelect={(id) => show(id, true)}
                    onToggleFavorite={() =>
                      setPrefs({
                        ...prefs,
                        favorites: prefs.favorites.includes(selected.id)
                          ? prefs.favorites.filter((f) => f !== selected.id)
                          : [...prefs.favorites, selected.id],
                      })
                    }
                  />
                  <div className="mt-4 border-t border-line pt-4">
                    <ActTrackerAreaGuide
                      areaId={selected.id}
                      tracking={tracking}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-fg-muted">
                  Choose an area on the left or on the map, or play — the Atlas
                  follows the area you enter.
                </p>
              )}
            </div>
          </main>
        </div>
      )}

      <StatusStrip
        prefs={prefs}
        setPrefs={setPrefs}
        tracking={tracking}
        here={here}
        onShowHere={() => here && show(here, false)}
      />
    </div>
  );
}

const EMPTY: ReadonlySet<string> = new Set();

function StatusStrip({
  prefs,
  setPrefs,
  tracking,
  here,
  onShowHere,
}: {
  prefs: AtlasPrefs;
  setPrefs: (p: AtlasPrefs) => void;
  tracking: ReturnType<typeof useAtlasTracking>;
  here: string | null;
  onShowHere: () => void;
}) {
  const loc = tracking.location?.location;
  const text = tracking.error
    ? tracking.error
    : !tracking.character
      ? "No PoE 1 campaign character in your log yet."
      : loc?.kind === "in-area"
        ? `${tracking.character.name} is in ${loc.area.name} (Act ${loc.area.act}, area level ${loc.level ?? loc.area.level})`
        : loc?.kind === "outside"
          ? `${tracking.character.name} is outside the campaign${loc.last ? ` — last campaign area: ${loc.last.name}` : ""}`
          : `${tracking.character.name}: no area entered yet`;
  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-line bg-bg-2 px-3 text-2xs text-fg-subtle">
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 truncate",
          tracking.error && "text-warning",
        )}
      >
        <Icon
          name={tracking.error ? "warning" : "journal"}
          size={12}
          className="shrink-0"
        />
        <span className="truncate">{text}</span>
        <span className="shrink-0 text-fg-disabled">
          · from Client.txt (read-only)
        </span>
      </span>
      {here && !prefs.follow && (
        <button
          type="button"
          className="text-fg-muted hover:text-fg"
          onClick={onShowHere}
        >
          Show where I am
        </button>
      )}
      <label className="flex cursor-pointer items-center gap-1.5 text-fg-muted">
        <input
          type="checkbox"
          className="accent-[var(--color-accent)]"
          checked={prefs.follow}
          onChange={(e) => setPrefs({ ...prefs, follow: e.target.checked })}
        />
        Follow my location
      </label>
    </footer>
  );
}
