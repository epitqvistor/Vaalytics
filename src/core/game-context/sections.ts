import type { IconName } from "@/shared/icons/icons";
import type { GameId } from "./games";

/** Sections of a game environment. */
export type SectionId = "dashboard" | "price-checker" | "currency" | "trade" | "builds" | "crafting" | "tools" | "browser" | "settings";

export interface SectionProps {
  onNavigate: (section: SectionId) => void;
}

export interface SectionMeta {
  label: string;
  icon: IconName;
  /** Games where the section is planned: shown with an honest placeholder, marked in navigation. */
  plannedFor?: readonly GameId[];
}

export const SECTION_META: Record<SectionId, SectionMeta> = {
  dashboard: { label: "Dashboard", icon: "dashboard" },
  "price-checker": { label: "Price Checker", icon: "priceCheck" },
  currency: { label: "Currency Tracker", icon: "currency" },
  trade: { label: "Trade", icon: "trade" },
  builds: { label: "Builds", icon: "builds" },
  crafting: { label: "Crafting", icon: "crafting", plannedFor: ["poe2"] },
  tools: { label: "Path of Building & Tools", icon: "tools" },
  browser: { label: "Browser", icon: "browser" },
  settings: { label: "Settings", icon: "settings" },
};

export const NAV_GROUPS: { label: string; items: SectionId[] }[] = [
  { label: "Market", items: ["dashboard", "price-checker", "currency", "trade"] },
  { label: "Builds", items: ["builds", "tools", "crafting"] },
  { label: "Web", items: ["browser"] },
];
