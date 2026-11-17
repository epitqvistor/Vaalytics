import { describe, expect, it } from "vitest";
import { GAME_IDS, GAMES, isGameId } from "./games";

describe("game registry", () => {
  it("has a descriptor for every id, keyed consistently", () => {
    for (const id of GAME_IDS) {
      expect(GAMES[id].id).toBe(id);
    }
    expect(Object.keys(GAMES).sort()).toEqual([...GAME_IDS].sort());
  });

  it("validates ids", () => {
    expect(isGameId("poe1")).toBe(true);
    expect(isGameId("poe2")).toBe(true);
    expect(isGameId("poe3")).toBe(false);
    expect(isGameId(null)).toBe(false);
  });
});
