import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { GameId } from "@/core/game-context/games";
import type { SectionId, SectionProps } from "@/core/game-context/sections";
import { statusFor } from "@/core/modules/registry";

type SectionComponent = LazyExoticComponent<ComponentType<SectionProps>>;

// Game-agnostic views (they read the active game from context).
const shared = {
  trade: lazy(() => import("@/shared/views/TradeView")),
  builds: lazy(() => import("@/shared/views/BuildsView")),
  tools: lazy(() => import("@/shared/views/ToolsView")),
  browser: lazy(() => import("@/browser/BrowserView")),
  settings: lazy(() => import("@/core/settings/SettingsPage")),
  "update-center": lazy(() => import("@/shared/views/update-center")),
};

/** Honest page for modules that are registered but not built yet. */
const Planned = lazy(() => import("@/core/modules/PlannedModuleView"));

/**
 * Implemented views per game. The app shell is the only place that knows about
 * both game modules; each view is code-split and loaded on first visit.
 */
const READY: Record<GameId, Partial<Record<SectionId, SectionComponent>>> = {
  poe1: {
    dashboard: lazy(() => import("@/games/poe1/dashboard")),
    "price-checker": lazy(() => import("@/games/poe1/price-checker")),
    currency: lazy(() => import("@/games/poe1/currency")),
    "market-intelligence": lazy(() => import("@/games/poe1/market-intelligence")),
    ...shared,
    crafting: lazy(() => import("@/games/poe1/crafting")),
    "loot-intelligence": lazy(() => import("@/games/poe1/loot-intelligence")),
    "location-atlas": lazy(() => import("@/games/poe1/location-atlas")),
    "act-tracker": lazy(() => import("@/games/poe1/act-tracker")),
    regex: lazy(() => import("@/games/poe1/regex")),
    "ultimatum-checker": lazy(() => import("@/games/poe1/ultimatum")),
    "deck-intelligence": lazy(() => import("@/games/poe1/deck-intelligence")),
  },
  poe2: {
    dashboard: lazy(() => import("@/games/poe2/dashboard")),
    "price-checker": lazy(() => import("@/games/poe2/price-checker")),
    currency: lazy(() => import("@/games/poe2/currency")),
    "market-intelligence": lazy(() => import("@/games/poe2/market-intelligence")),
    "session-intelligence": lazy(() => import("@/games/poe2/session-intelligence")),
    "loot-journal": lazy(() => import("@/games/poe2/loot-journal")),
    "campaign-intelligence": lazy(() => import("@/games/poe2/campaign-intelligence")),
    ...shared,
  },
};

/** View for a module: the implemented one when `ready`, otherwise the planned page. */
export function viewFor(game: GameId, id: SectionId): SectionComponent {
  const ready = READY[game][id];
  return statusFor(id, game) === "ready" && ready ? ready : Planned;
}

/** Ready modules must have a view (checked by tests). */
export const READY_VIEWS = READY;
