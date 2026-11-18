import { describe, expect, it } from "vitest";
import { READY_VIEWS } from "@/app/sections";
import { GAME_IDS } from "@/core/game-context/games";
import { MODULE_GROUPS, MODULES, navigationFor } from "./registry";

describe("module registry", () => {
  it("ids are unique and every module belongs to a known group", () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODULES) if (m.group !== null) expect(MODULE_GROUPS.some((g) => g.id === m.group)).toBe(true);
  });

  it("every ready module has a view, every planned module says what it will do", () => {
    for (const game of GAME_IDS) {
      for (const m of MODULES) {
        const s = m.availability[game];
        if (s === "ready") expect(READY_VIEWS[game][m.id], `${game}/${m.id}`).toBeDefined();
        if (s === "planned") {
          expect(m.plan?.scope.length, m.id).toBeGreaterThan(0);
          expect(m.plan?.data.length, m.id).toBeGreaterThan(0);
        }
      }
    }
  });

  it("navigation hides planned modules unless asked, and keeps settings in the footer", () => {
    const off = navigationFor("poe1", { showPlanned: false });
    const on = navigationFor("poe1", { showPlanned: true });
    const ids = (n: typeof off) => n.groups.flatMap((g) => g.items.map((m) => m.id));
    expect(ids(off)).not.toContain("thread-planner");
    expect(ids(on)).toContain("thread-planner");
    expect(off.groups.map((g) => g.id)).toEqual(["overview", "economy", "endgame", "character", "tools"]);
    expect(off.groups.find((g) => g.id === "endgame")!.items.map((m) => m.id)).toEqual(["map-lab", "farming-lab", "loot-intelligence"]);
    expect(on.groups.map((g) => g.id)).toEqual(["overview", "economy", "endgame", "character", "tools"]);
    expect(off.footer.map((m) => m.id)).toEqual(["settings"]);
    expect(off.groups.find((g) => g.id === "overview")!.items.map((m) => m.id)).toEqual(["dashboard"]);
  });

  it("PoE 1 endgame modules are not offered for PoE 2", () => {
    const poe2 = navigationFor("poe2", { showPlanned: true });
    expect(poe2.groups.some((g) => g.id === "endgame")).toBe(false);
    expect(poe2.groups.find((g) => g.id === "overview")!.items.map((m) => m.id)).toEqual(["dashboard"]);
    expect(poe2.groups.find((g) => g.id === "tools")!.items.map((m) => m.id)).toEqual(["crafting", "session-intelligence", "loot-journal", "browser"]);
    expect(poe2.groups.flatMap((g) => g.items).find((m) => m.id === "crafting")?.availability.poe2).toBe("planned");
  });
});
