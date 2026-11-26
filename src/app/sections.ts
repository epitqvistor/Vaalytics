import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { GameId } from "@/core/game-context/games";
import type { SectionId, SectionProps } from "@/core/game-context/sections";
import { statusFor } from "@/core/modules/registry";

type SectionModule = { default: ComponentType<SectionProps> };

/**
 * A code-split section view. `Lazy` is used until the chunk has loaded once; after
 * that `viewFor` returns the loaded component itself, so switching to it never
 * suspends (no loading spinner). `preload` fetches the chunk ahead of a click.
 */
interface SectionView {
  Lazy: LazyExoticComponent<ComponentType<SectionProps>>;
  preload: () => Promise<unknown>;
  loaded: ComponentType<SectionProps> | null;
}

function view(load: () => Promise<SectionModule>): SectionView {
  let pending: Promise<SectionModule> | null = null;
  const v: SectionView = {
    loaded: null,
    preload: () => (pending ??= load().then((m) => ((v.loaded = m.default), m))).catch(() => (pending = null)),
    Lazy: lazy(() => (pending ??= load().then((m) => ((v.loaded = m.default), m)))),
  };
  return v;
}

// Game-agnostic views (they read the active game from context).
const shared = {
  trade: view(() => import("@/shared/views/TradeView")),
  builds: view(() => import("@/shared/views/BuildsView")),
  tools: view(() => import("@/shared/views/ToolsView")),
  browser: view(() => import("@/browser/BrowserView")),
  settings: view(() => import("@/core/settings/SettingsPage")),
  "update-center": view(() => import("@/shared/views/update-center")),
};

/** Honest page for modules that are registered but not built yet. */
const Planned = view(() => import("@/core/modules/PlannedModuleView"));

/**
 * Implemented views per game. The app shell is the only place that knows about
 * both game modules; each view is code-split, preloaded while idle and on hover.
 */
const READY: Record<GameId, Partial<Record<SectionId, SectionView>>> = {
  poe1: {
    dashboard: view(() => import("@/games/poe1/dashboard")),
    "price-checker": view(() => import("@/games/poe1/price-checker")),
    currency: view(() => import("@/games/poe1/currency")),
    "market-intelligence": view(() => import("@/games/poe1/market-intelligence")),
    ...shared,
    crafting: view(() => import("@/games/poe1/crafting")),
    "loot-intelligence": view(() => import("@/games/poe1/loot-intelligence")),
    "location-atlas": view(() => import("@/games/poe1/location-atlas")),
    "act-tracker": view(() => import("@/games/poe1/act-tracker")),
    regex: view(() => import("@/games/poe1/regex")),
    "ultimatum-checker": view(() => import("@/games/poe1/ultimatum")),
    "deck-intelligence": view(() => import("@/games/poe1/deck-intelligence")),
  },
  poe2: {
    dashboard: view(() => import("@/games/poe2/dashboard")),
    "price-checker": view(() => import("@/games/poe2/price-checker")),
    currency: view(() => import("@/games/poe2/currency")),
    "market-intelligence": view(() => import("@/games/poe2/market-intelligence")),
    "session-intelligence": view(() => import("@/games/poe2/session-intelligence")),
    "loot-journal": view(() => import("@/games/poe2/loot-journal")),
    "campaign-intelligence": view(() => import("@/games/poe2/campaign-intelligence")),
    ...shared,
  },
};

function entryFor(game: GameId, id: SectionId): SectionView {
  const ready = READY[game][id];
  return statusFor(id, game) === "ready" && ready ? ready : Planned;
}

/** Component for a module: the implemented one when `ready`, otherwise the planned page. */
export function viewFor(game: GameId, id: SectionId): ComponentType<SectionProps> {
  const v = entryFor(game, id);
  return v.loaded ?? v.Lazy;
}

/** Start loading a section's code (e.g. on nav hover). Safe to call repeatedly. */
export function preloadView(game: GameId, id: SectionId): void {
  void entryFor(game, id).preload();
}

/**
 * Loads every section chunk of a game one at a time while the app is idle, so
 * later switches never show a spinner. Returns a cancel function.
 */
export function preloadAllViews(game: GameId): () => void {
  const queue = [...new Set([...Object.values(READY[game]), Planned])].filter((v): v is SectionView => !!v && !v.loaded);
  let cancelled = false;
  let handle = 0;
  const idle = (cb: () => void) =>
    typeof requestIdleCallback === "function" ? requestIdleCallback(cb, { timeout: 2000 }) : window.setTimeout(cb, 200);
  const next = () => {
    if (cancelled) return;
    const v = queue.shift();
    if (!v) return;
    void v.preload().finally(() => (handle = idle(next)));
  };
  handle = idle(next);
  return () => {
    cancelled = true;
    if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle);
    else window.clearTimeout(handle);
  };
}

/** Ready modules must have a view (checked by tests). */
export const READY_VIEWS = READY;
