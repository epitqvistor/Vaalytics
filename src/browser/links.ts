import type { GameId } from "@/core/game-context/games";
import type { IconName } from "@/shared/icons/icons";

export interface QuickLinkDef {
  title: string;
  host: string;
  url: string;
  icon: IconName;
}

/** Start-page shortcuts per game. Official/first-party sites only. */
export const POE_LINKS: Record<GameId, QuickLinkDef[]> = {
  poe1: [
    { title: "Path of Exile", host: "pathofexile.com", url: "https://www.pathofexile.com/", icon: "browser" },
    { title: "Official Trade", host: "pathofexile.com/trade", url: "https://www.pathofexile.com/trade", icon: "trade" },
    { title: "poe.ninja", host: "poe.ninja", url: "https://poe.ninja/", icon: "currency" },
  ],
  poe2: [
    { title: "Path of Exile 2", host: "pathofexile2.com", url: "https://pathofexile2.com/", icon: "browser" },
    { title: "Official Trade", host: "pathofexile.com/trade2", url: "https://www.pathofexile.com/trade2", icon: "trade" },
    { title: "poe.ninja", host: "poe.ninja/poe2", url: "https://poe.ninja/poe2", icon: "currency" },
  ],
};
