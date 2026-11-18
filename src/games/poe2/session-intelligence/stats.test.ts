import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@/core/ipc/commands";
import { avgMapSecs, byDay, byWeek, change, clock, compareSessions, dur, kindBreakdown, overlapSecs, periodTotals, perHour, startOfWeek, totals } from "./stats";

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime() / 1000;

function s(id: number, start: number, secs: number, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    startedAt: start,
    endedAt: start + secs,
    lastActivityAt: start + secs,
    status: "completed",
    endReason: "game_closed",
    logTracked: true,
    durationSecs: secs,
    mapsEntered: 0,
    areasEntered: 0,
    mapSecs: 0,
    hideoutSecs: 0,
    townSecs: 0,
    campaignSecs: 0,
    contentSecs: 0,
    unknownSecs: 0,
    loadingSecs: 0,
    afkSecs: 0,
    deaths: 0,
    levelUps: 0,
    ...over,
  };
}

describe("session stats", () => {
  it("rates need enough time and maps", () => {
    expect(perHour(6, 3600)).toBe(6);
    expect(perHour(1, 30)).toBeNull();
    expect(avgMapSecs({ mapSecs: 600, mapsEntered: 3 })).toBe(200);
    expect(avgMapSecs({ mapSecs: 0, mapsEntered: 0 })).toBeNull();
  });

  it("totals ignore map figures of sessions without Client.txt", () => {
    const t = totals([
      s(1, 0, 3600, { mapsEntered: 10, mapSecs: 3000, hideoutSecs: 400, townSecs: 200 }),
      s(2, 5000, 3600, { logTracked: false }),
    ]);
    expect(t.sessions).toBe(2);
    expect(t.tracked).toBe(1);
    expect(t.durationSecs).toBe(7200);
    expect(t.maps).toBe(10);
    expect(t.mapsPerHour).toBe(10);
    expect(t.avgMapSecs).toBe(300);
    expect(t.downtimeShare).toBeCloseTo(600 / 3600);
    expect(totals([s(3, 0, 600, { logTracked: false })]).mapsPerHour).toBeNull();
  });

  it("splits sessions across midnight into days", () => {
    const start = local(2026, 11, 16, 23, 0);
    const sess = s(1, start, 2 * 3600, { mapsEntered: 4 });
    expect(overlapSecs(sess, local(2026, 11, 17) * 1000, local(2026, 11, 18) * 1000)).toBe(3600);
    const days = byDay([sess], 3, local(2026, 11, 17, 12) * 1000);
    expect(days.map((d) => d.playedSecs)).toEqual([0, 3600, 3600]);
    expect(days.map((d) => d.maps)).toEqual([0, 4, 0]);
    expect(days[2]!.key).toBe("2026-11-17");
  });

  it("weeks start on Monday", () => {
    const wed = local(2026, 11, 18, 15) * 1000; // Wednesday
    expect(new Date(startOfWeek(wed)).getDay()).toBe(1);
    const weeks = byWeek([s(1, local(2026, 11, 10, 20), 3600), s(2, local(2026, 11, 17, 20), 1800)], 2, wed);
    expect(weeks.map((w) => w.playedSecs)).toEqual([3600, 1800]);
  });

  it("compares day vs previous day", () => {
    const now = local(2026, 11, 17, 12) * 1000;
    const all = [s(1, local(2026, 11, 16, 10), 3600, { mapsEntered: 6 }), s(2, local(2026, 11, 17, 9), 1800, { mapsEntered: 4 })];
    expect(periodTotals(all, "day", now, 0).maps).toBe(4);
    expect(periodTotals(all, "day", now, -1).durationSecs).toBe(3600);
    expect(periodTotals(all, "week", now, 0).sessions).toBe(2);
  });

  it("session comparison marks unknown values as null", () => {
    const m = compareSessions(s(1, 0, 3600, { mapsEntered: 8, mapSecs: 2400 }), s(2, 0, 3600, { logTracked: false }));
    const maps = m.find((x) => x.id === "maps")!;
    expect(maps.a).toBe(8);
    expect(maps.b).toBeNull();
    expect(change(maps.a, maps.b)).toBeNull();
    expect(change(12, 8)).toBe(0.5);
  });

  it("formats and breaks down", () => {
    expect(clock(3725)).toBe("1:02:05");
    expect(dur(3725)).toBe("1h 02m");
    expect(dur(65)).toBe("1m 05s");
    expect(dur(null)).toBe("—");
    expect(kindBreakdown(s(1, 0, 100, { mapSecs: 50, townSecs: 70 })).map((k) => k.kind)).toEqual(["town", "map"]);
  });
});
