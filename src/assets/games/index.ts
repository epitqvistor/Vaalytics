/**
 * Game artwork manifest. To use approved official artwork instead, place the
 * optimized file next to this one (e.g. poe1.webp, ~1200×1600, < 300 KB) and
 * point `art` at it. See docs/modules/game-artwork.md for licensing rules.
 */
import type { GameId } from "@/core/game-context/games";
import poe1Art from "./poe1-wraeclast.svg";
import poe2Art from "./poe2-vaal.svg";

export interface GameArt {
  art: string;
  /** CSS object-position: keeps the focal point visible when cropped. */
  focus: string;
  /** Short, honest credit shown in the UI. */
  credit: string;
}

export const GAME_ART: Record<GameId, GameArt> = {
  poe1: { art: poe1Art, focus: "40% 60%", credit: "Original Vaalytics illustration" },
  poe2: { art: poe2Art, focus: "50% 45%", credit: "Original Vaalytics illustration" },
};
