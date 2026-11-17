import type { GameConfig } from "@/core/game-context/config";

export const POE1_CONFIG: GameConfig = {
  id: "poe1",
  baseUnit: { id: "chaos", short: "c", name: "Chaos Orb" },
  premiumUnit: { id: "divine", short: "div", name: "Divine Orb" },
  keyCurrencies: ["divine", "hinekoras-lock", "mirror"],
  // Divine in chaos (its rate), Hinekora's Lock in divines; Mirror follows "Prices in".
  keyCurrencyUnits: { divine: "base", "hinekoras-lock": "premium" },
  links: {
    officialSite: "https://www.pathofexile.com/",
    trade: "https://www.pathofexile.com/trade",
    ninja: "https://poe.ninja/",
  },
};
