/**
 * Game registry. The single source of truth for which games Vaalytics supports.
 * Game ids mirror the Rust `GameId` enum (src-tauri/src/game.rs) exactly.
 *
 * Future games (Torchlight Infinite, Last Epoch, Diablo IV) are added here only
 * once they have a real implementation — never as placeholders.
 */
export const GAME_IDS = ["poe1", "poe2"] as const;
export type GameId = (typeof GAME_IDS)[number];

export interface GameDescriptor {
  id: GameId;
  title: string;
  shortTitle: string;
  tagline: string;
}

export const GAMES: Readonly<Record<GameId, GameDescriptor>> = {
  poe1: {
    id: "poe1",
    title: "Path of Exile",
    shortTitle: "PoE 1",
    tagline: "Price checks, currency markets and build tools for Path of Exile.",
  },
  poe2: {
    id: "poe2",
    title: "Path of Exile 2",
    shortTitle: "PoE 2",
    tagline: "Price checks, currency markets and build tools for Path of Exile 2.",
  },
};

export function isGameId(value: unknown): value is GameId {
  return typeof value === "string" && (GAME_IDS as readonly string[]).includes(value);
}
