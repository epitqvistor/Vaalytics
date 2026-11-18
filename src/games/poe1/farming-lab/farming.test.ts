import { describe, expect, it } from "vitest";
import { compareStrategies, formatDuration, isSession, totals, type FarmingSession, type Line } from "./farming";

const line = (name: string, qty: number, unitPrice: number): Line => ({ id: name, name, qty, unitPrice, source: "manual" });
const session = (strategy: string, hours: number, maps: number, loot: Line[], costs: Line[] = []): FarmingSession => ({
  id: Math.random().toString(36).slice(2),
  league: "Covens",
  strategy,
  startedAt: 0,
  durationSecs: hours * 3600,
  maps,
  data: { loot, costs, notes: "" },
  savedAt: 0,
});

describe("session totals", () => {
  it("profit, per hour and per map from recorded lines", () => {
    const t = totals(session("x", 2, 10, [line("Divine Orb", 2, 155), line("Chaos Orb", 90, 1)], [line("Thread", 10, 5)]));
    expect(t).toEqual({ loot: 400, cost: 50, profit: 350, perHour: 175, perMap: 35 });
  });

  it("no rate without duration or maps", () => {
    const t = totals(session("x", 0, 0, [line("a", 1, 10)]));
    expect([t.perHour, t.perMap]).toEqual([null, null]);
  });
});

describe("strategy comparison", () => {
  const sessions = [
    session("Essence + Harbinger", 1, 10, [line("loot", 1, 300)]),
    session("essence  +  harbinger", 3, 30, [line("loot", 1, 300)]),
    session("Blight", 1, 8, [line("loot", 1, 250)], [line("oils", 1, 50)]),
  ];

  it("pools sessions of one strategy and ranks by profit per hour", () => {
    const s = compareStrategies(sessions);
    expect(s.map((x) => x.strategy)).toEqual(["Blight", "Essence + Harbinger"]);
    const eh = s[1]!;
    expect([eh.sessions, eh.hours, eh.maps, eh.profit]).toEqual([2, 4, 40, 600]);
    expect(eh.perHour).toBe(150); // pooled 600 / 4 h, not the mean of 300 and 100
    expect([eh.bestPerHour, eh.worstPerHour]).toEqual([300, 100]);
    expect(s[0]!.perHour).toBe(200);
  });
});

describe("validation and formatting", () => {
  it("accepts well-formed sessions only", () => {
    expect(isSession(session("x", 1, 1, [line("a", 1, 1)]))).toBe(true);
    expect(isSession({ ...session("x", 1, 1, []), data: { loot: [{ name: "a" }], costs: [], notes: "" } })).toBe(false);
    expect(isSession({ ...session("x", 1, 1, []), data: null })).toBe(false);
  });

  it("formats durations", () => {
    expect(formatDuration(3900)).toBe("1 h 05 min");
    expect(formatDuration(600)).toBe("10 min");
  });
});
