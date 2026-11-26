/**
 * Module registry: every feature is a module with its own navigation entry,
 * view and folder. Navigation, page eyebrows and planned pages are generated
 * from this list. Spec: docs/architecture/modules.md
 *
 * A module is offered per game: `ready` (implemented view), `planned` (honest
 * "not built yet" page, shown in navigation only when the user enables
 * "Show planned modules"), or absent (not offered for that game).
 */
import type { GameId } from "@/core/game-context/games";
import type { IconName } from "@/shared/icons/icons";

export type ModuleId =
  // Overview
  | "dashboard"
  // Economy
  | "price-checker"
  | "currency"
  | "trade"
  | "market-intelligence"
  | "deck-intelligence"
  | "mercenary-intelligence"
  // Endgame (PoE 1 3.30)
  | "atlas-planner"
  | "thread-planner"
  | "fate-planner"
  | "loot-intelligence"
  | "ultimatum-checker"
  // Character
  | "campaign-intelligence"
  | "location-atlas"
  | "act-tracker"
  | "builds"
  | "tools"
  // Tools
  | "crafting"
  | "regex"
  | "session-intelligence"
  | "loot-journal"
  | "browser"
  // Application
  | "update-center"
  | "settings";

export type ModuleGroupId = "overview" | "economy" | "endgame" | "character" | "tools";
export type ModuleStatus = "ready" | "planned";

export interface ModuleMeta {
  id: ModuleId;
  label: string;
  icon: IconName;
  /** `null` for application-level entries (Settings) shown outside the groups. */
  group: ModuleGroupId | null;
  /** One sentence: what the module is for. */
  summary: string;
  /** Status per game; a game without an entry doesn't offer the module. */
  availability: Partial<Record<GameId, ModuleStatus>>;
  /** For planned modules: what it will do and which data it will use. */
  plan?: { scope: string[]; data: string[] };
}

export const MODULE_GROUPS: { id: ModuleGroupId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "economy", label: "Economy" },
  { id: "endgame", label: "Endgame" },
  { id: "character", label: "Character" },
  { id: "tools", label: "Tools" },
];

const BOTH = { poe1: "ready", poe2: "ready" } as const;

export const MODULES: readonly ModuleMeta[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", group: "overview", summary: "Key prices, your watchlist and the biggest market movers.", availability: BOTH },

  { id: "price-checker", label: "Price Checker", icon: "priceCheck", group: "economy", summary: "Price an item from the game with live listings from the official Trade site.", availability: BOTH },
  { id: "currency", label: "Currency Tracker", icon: "currency", group: "economy", summary: "Live poe.ninja prices for every market category, with history and favourites.", availability: BOTH },
  { id: "trade", label: "Trade", icon: "trade", group: "economy", summary: "Shortcuts to the official Trade site for the selected league.", availability: BOTH },
  {
    id: "market-intelligence",
    label: "Market Intelligence",
    icon: "chart",
    group: "economy",
    summary: "Trends, movers, liquidity and price alerts across every market category, from data Vaalytics already caches.",
    availability: BOTH,
  },

  {
    id: "deck-intelligence",
    label: "Deck Intelligence",
    icon: "cards",
    group: "economy",
    summary: "Track your Stacked Deck openings from Client.txt and ground screenshots, with a permanent history, valuations and statistics.",
    availability: { poe1: "ready" },
  },
  {
    id: "mercenary-intelligence",
    label: "Mercenary Intelligence",
    icon: "journal",
    group: "economy",
    summary: "Value a Mercenary Warrant for sale: family, skills and bound supports read from Ctrl+C, comparable listings from the official Trade site, an asking range with its confidence and the evidence behind it.",
    availability: { poe1: "ready" },
  },
  {
    id: "atlas-planner",
    label: "Atlas Planner",
    icon: "atlas",
    group: "endgame",
    summary: "Plan the 3.30 Atlas passive tree (150 points) and compare strategies.",
    availability: { poe1: "planned" },
    plan: {
      scope: ["Atlas passive tree editor for the 3.30 rework (150 points)", "Saved trees per strategy, export/import"],
      data: ["Atlas tree data for the selected patch (versioned game data)", "User-provided allocations"],
    },
  },
  {
    id: "thread-planner",
    label: "Thread Planner",
    icon: "thread",
    group: "endgame",
    summary: "Choose Threads of Creation (they replace Scarabs in 3.30) and track their cost.",
    availability: { poe1: "planned" },
    plan: {
      scope: ["Thread setups per map and their mechanic", "Cost per map from live prices"],
      data: ["Thread definitions for 3.30 (versioned game data)", "Prices from the Market engine, with source and time"],
    },
  },
  {
    id: "fate-planner",
    label: "Fate Planner",
    icon: "fate",
    group: "endgame",
    summary: "Covens of Umbra: Fates for area bosses and Viscera for your Wickerman.",
    availability: { poe1: "planned" },
    plan: {
      scope: ["Fate choices and what they empower", "Viscera collected and Wickerman progress (user-tracked)"],
      data: ["Covens mechanic definitions for 3.30 (versioned game data)", "User-provided progress"],
    },
  },
  {
    id: "loot-intelligence",
    label: "Loot Intelligence",
    icon: "gem",
    group: "endgame",
    summary: "Which drops are worth picking up in this league, from live prices, with a matching loot-filter block.",
    availability: { poe1: "ready" },
  },
  {
    id: "ultimatum-checker",
    label: "Ultimatum Checker",
    icon: "boss",
    group: "endgame",
    summary: "Check an Inscribed Ultimatum with the price-check hotkey: your verdict on its modifiers, what the sacrifice and reward are worth, and a Trade search.",
    availability: { poe1: "ready" },
  },

  {
    id: "campaign-intelligence",
    label: "Campaign Intelligence",
    icon: "map",
    group: "character",
    summary: "Where to go next in the PoE 2 campaign and what to do there — step-by-step objectives and permanent rewards, from your Client.txt progress and verified 0.5.5 campaign data.",
    availability: { poe2: "ready" },
  },
  {
    id: "location-atlas",
    label: "Location Atlas",
    icon: "atlas",
    group: "character",
    summary: "The Acts 1–10 campaign in a separate window: real connections between areas, waypoints, community navigation hints and the area you are in, from your Client.txt.",
    availability: { poe1: "ready" },
  },
  {
    id: "act-tracker",
    label: "Act Tracker",
    icon: "waypoint",
    group: "character",
    summary: "Live campaign guide for Acts 1–10 in a small overlay that stays on top of the game: your current objective, the next steps and all 24 quest passive points, from your Client.txt.",
    availability: { poe1: "ready" },
  },
  { id: "builds", label: "Builds", icon: "builds", group: "character", summary: "Your Path of Building builds for this game.", availability: BOTH },
  { id: "tools", label: "Path of Building & Tools", icon: "tools", group: "character", summary: "Launch Path of Building and open trusted community tools.", availability: BOTH },

  {
    id: "crafting",
    label: "Crafting",
    icon: "crafting",
    group: "tools",
    summary: "Mod odds from the game data, method costs from live prices, a currency emulator and Monte Carlo.",
    availability: { poe1: "ready", poe2: "planned" },
    plan: {
      scope: ["PoE 2 crafting (omens, essences, runes) on PoE 2 game data"],
      data: ["RePoE data for PoE 2", "PoE 2 prices from the Market engine"],
    },
  },
  {
    id: "regex",
    label: "REGEX",
    icon: "regex",
    group: "tools",
    summary: "Stash, vendor and map search strings from 3.30 game data, with a library and quick slots.",
    availability: { poe1: "ready" },
  },
  {
    id: "session-intelligence",
    label: "Session Intelligence",
    icon: "clock",
    group: "tools",
    summary: "Your game sessions, recorded automatically from the game process and Client.txt: time, areas, maps and trends.",
    availability: { poe2: "ready" },
  },
  {
    id: "loot-journal",
    label: "Loot Journal",
    icon: "journal",
    group: "tools",
    summary: "Items you copy in the game (Ctrl+C) are captured, categorised and valued automatically — captured items only, not all your loot.",
    availability: { poe2: "ready" },
  },
  { id: "browser", label: "Browser", icon: "browser", group: "tools", summary: "Web pages inside Vaalytics, with your own sign-ins.", availability: BOTH },

  {
    id: "update-center",
    label: "Update Center",
    icon: "refresh",
    group: null,
    summary: "Check, review, apply and roll back game-data updates for both games — sources, league profiles, official patch notes and history in one place.",
    availability: BOTH,
  },
  { id: "settings", label: "Settings", icon: "settings", group: null, summary: "Preferences, per-game settings and diagnostics.", availability: BOTH },
];

const BY_ID = new Map(MODULES.map((m) => [m.id, m]));
export const moduleMeta = (id: ModuleId): ModuleMeta => BY_ID.get(id)!;

export const statusFor = (id: ModuleId, game: GameId): ModuleStatus | undefined => BY_ID.get(id)?.availability[game];

/** Modules shown in a game's navigation, grouped and in registry order. */
export function navigationFor(game: GameId, opts: { showPlanned: boolean }) {
  const visible = (m: ModuleMeta) => {
    const s = m.availability[game];
    return s === "ready" || (s === "planned" && opts.showPlanned);
  };
  return {
    groups: MODULE_GROUPS.map((g) => ({ ...g, items: MODULES.filter((m) => m.group === g.id && visible(m)) })).filter((g) => g.items.length > 0),
    footer: MODULES.filter((m) => m.group === null && visible(m)),
  };
}
