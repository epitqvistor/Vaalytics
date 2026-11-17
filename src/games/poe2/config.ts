import type { GameConfig } from "@/core/game-context/config";

export const POE2_CONFIG: GameConfig = {
  id: "poe2",
  baseUnit: { id: "exalted", short: "ex", name: "Exalted Orb" },
  premiumUnit: { id: "divine", short: "div", name: "Divine Orb" },
  keyCurrencies: ["divine", "chaos", "mirror"],
  links: {
    officialSite: "https://pathofexile2.com/",
    trade: "https://www.pathofexile.com/trade2",
    ninja: "https://poe.ninja/poe2",
  },
};
