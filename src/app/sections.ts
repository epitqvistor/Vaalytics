import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { GameId } from "@/core/game-context/games";
import type { SectionId, SectionProps } from "@/core/game-context/sections";

type SectionComponent = LazyExoticComponent<ComponentType<SectionProps>>;

// Game-agnostic sections (PoE 1 overrides crafting with its own calculator) (they read the active game from context).
const shared = {
  trade: lazy(() => import("@/shared/views/TradeView")),
  builds: lazy(() => import("@/shared/views/BuildsView")),
  crafting: lazy(() => import("@/shared/views/CraftingView")),
  tools: lazy(() => import("@/shared/views/ToolsView")),
  browser: lazy(() => import("@/browser/BrowserView")),
  settings: lazy(() => import("@/core/settings/SettingsPage")),
};

/**
 * Section registry. The app shell is the only place that knows about both game
 * modules; each module is code-split and loaded on first visit.
 */
export const SECTIONS: Record<GameId, Record<SectionId, SectionComponent>> = {
  poe1: {
    dashboard: lazy(() => import("@/games/poe1/dashboard")),
    "price-checker": lazy(() => import("@/games/poe1/price-checker")),
    currency: lazy(() => import("@/games/poe1/currency")),
    ...shared,
    crafting: lazy(() => import("@/games/poe1/crafting")),
  },
  poe2: {
    dashboard: lazy(() => import("@/games/poe2/dashboard")),
    "price-checker": lazy(() => import("@/games/poe2/price-checker")),
    currency: lazy(() => import("@/games/poe2/currency")),
    ...shared,
  },
};
