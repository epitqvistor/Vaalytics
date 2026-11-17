import type { GameConfig } from "@/core/game-context/config";

export const POE1_CONFIG: GameConfig = {
  id: "poe1",
  baseUnit: { id: "chaos", short: "c", name: "Chaos Orb" },
  premiumUnit: { id: "divine", short: "div", name: "Divine Orb" },
  keyCurrencies: ["divine", "exalted", "mirror"],
  links: {
    officialSite: "https://www.pathofexile.com/",
    trade: "https://www.pathofexile.com/trade",
    ninja: "https://poe.ninja/",
  },
};
