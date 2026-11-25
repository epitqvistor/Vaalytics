import type { ComponentType, LazyExoticComponent } from "react";
import type { ParsedItem } from "@/shared/item-parser/types";

/**
 * A game-specific check that replaces the Trade price check for some items
 * (PoE 1: Inscribed Ultimatum → Ultimatum Checker). Supplied by the game
 * module so shared views never import a game folder.
 */
export interface SpecialItemView {
  match: (item: ParsedItem) => boolean;
  Component: LazyExoticComponent<ComponentType<{ item: ParsedItem; league: string; compact?: boolean }>>;
}

export const specialFor = (views: readonly SpecialItemView[] | undefined, item: ParsedItem) => views?.find((v) => v.match(item)) ?? null;
