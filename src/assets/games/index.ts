/**
 * Game artwork manifest. Art files sit next to this one (portrait WebP,
 * < 300 KB). See docs/modules/game-artwork.md for sources and licensing rules.
 */
import type { GameId } from "@/core/game-context/games";
import poe1Art from "./poe1.webp";
import poe2Art from "./poe2.webp";

export interface GameArt {
  art: string;
  /** CSS object-position: keeps the focal point visible when cropped. */
  focus: string;
  /** Short, honest credit shown in the UI. */
  credit: string;
}

export const GAME_ART: Record<GameId, GameArt> = {
  poe1: { art: poe1Art, focus: "55% 55%", credit: "Original artwork supplied for Vaalytics" },
  poe2: { art: poe2Art, focus: "50% 45%", credit: "Original artwork supplied for Vaalytics" },
};
