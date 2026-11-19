import { beforeAll, describe, expect, it } from "vitest";
import type { CampaignEventRow, CampaignMark } from "@/core/ipc/commands";
import { loadTrackerDataset, type TrackerDataset } from "./data";
import { BANDITS, PASSIVE_REWARDS, REFUND_REWARDS, expectedQuestPoints } from "./data/rewards";
import type { BanditChoice } from "./data/types";
import { deriveProgress, stepMarkId } from "./engine/progress";
import { classifyQuests, isImportant } from "./engine/quests";
import { FAST_ALL_PASSIVES, type GuideOptions, resolveRoute, type ResolvedStep } from "./engine/route";

let ds: TrackerDataset;
beforeAll(async () => {
  const { dataset, issues } = await loadTrackerDataset();
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  ds = dataset!;
});

const ALL_OPTIONS: GuideOptions[] = (["kill", "alira", "kraityn", "oak"] as BanditChoice[]).flatMap((bandit) =>
  [false, true].flatMap((trials) => [false, true].flatMap((leagueStartExtras) => [false, true].map((library) => ({ bandit, trials, leagueStartExtras, library })))),
);
const route = (o: GuideOptions = FAST_ALL_PASSIVES.options) => resolveRoute(ds.route, o, ds.areas);
const zone = (areaId: string, at: number): CampaignEventRow => ({ at, kind: "zone", areaId, areaName: null, areaLevel: null, amount: null, detail: null });
/** Area entries a player following the route exactly would produce. */
const walk = (steps: readonly ResolvedStep[], from = 0, to = steps.length, t0 = 1000) =>
  steps.slice(from, to).flatMap((s, k) => (s.to ? [zone(s.to, t0 + k)] : []));
const progress = (steps: readonly ResolvedStep[], events: CampaignEventRow[], marks: CampaignMark[] = []) =>
  deriveProgress({ steps, events, marks, areas: ds.areas, route: ds.route });

describe("dataset", () => {
  it("has the 22 Book of Skill quests, the bandit point and 24 points in all", () => {
    expect(PASSIVE_REWARDS.filter((r) => r.type === "passive-points")).toHaveLength(22);
    expect(expectedQuestPoints("kill")).toBe(24);
    for (const b of ["alira", "kraityn", "oak"] as const) expect(expectedQuestPoints(b)).toBe(23);
    expect(PASSIVE_REWARDS.find((r) => r.quest === "An End to Hunger")?.points).toBe(2);
    expect(BANDITS.map((b) => b.id)).toEqual(["kill", "alira", "kraityn", "oak"]);
  });

  it("matches the order and names the game prints in /passives", () => {
    // From a real /passives output (Client.txt, 3.27+).
    const printed = [
      "The Dweller of the Deep", "The Marooned Mariner", "The Way Forward", "Through Sacred Ground", "Deal with the Bandits",
      "Victario's Secrets", "Piety's Pets", "An Indomitable Spirit", "In Service to Science", "Kitava's Torments",
      "The Father of War", "The Puppet Mistress", "The Cloven One", "The Master of a Million Faces", "Queen of Despair",
      "Kishara's Star", "Love is Dead", "Reflection of Terror", "The Gemling Legion", "Queen of the Sands",
      "The Ruler of Highgate", "Vilenta's Vengeance", "An End to Hunger",
    ];
    expect(PASSIVE_REWARDS.map((r) => r.quest)).toEqual(printed);
  });

  it("every reward has sources, a verification status, a date and a game version", () => {
    for (const r of [...PASSIVE_REWARDS, ...REFUND_REWARDS])
      for (const p of [r.provenance, r.details]) {
        expect(p.verification).toBeTruthy();
        expect(p.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(p.gameVersion).toBe("3.30");
      }
    expect(PASSIVE_REWARDS.every((r) => r.provenance.verification === "VERIFIED")).toBe(true);
  });

  it("classifies quests: passive, refund, gem, route and optional", () => {
    const qs = classifyQuests(ds.route, ds.rewards);
    expect(qs.filter((q) => q.categories.includes("passive"))).toHaveLength(23);
    expect(qs.filter((q) => q.categories.includes("refund")).map((q) => q.name).sort()).toEqual(
      ["A Dirty Job", "Fallen from Grace", "Fastis Fortuna", "No Love for Old Ghosts"],
    );
    const gem = qs.find((q) => q.name === "Enemy at the Gate")!;
    expect(gem.categories).toContain("gem");
    expect(isImportant(gem)).toBe(true); // on the route
    const optional = qs.find((q) => q.id === "a3q13")!; // A Swig of Hope, not on the route
    expect(isImportant(optional)).toBe(false);
  });
});

describe("route resolution", () => {
  it("for every option combination, each walk is a real game connection and every book reward is handed in in a town", () => {
    const problems = new Set<string>();
    for (const o of ALL_OPTIONS) {
      for (const s of route(o)) {
        const from = ds.areas.get(s.area);
        if (s.kind === "enter" && from && s.to && ds.areas.has(s.to) && !from.connections.includes(s.to))
          problems.add(`${s.id}: ${s.area} → ${s.to} is not a connection in the game data`);
        // Book rewards are given by town NPCs (some other hand-ins happen in the field, e.g. Web of Secrets).
        const book = s.kind === "hand-in" && (s.quests ?? []).some((q) => ds.route.quests[q.id]?.book);
        if (book && !(from?.kind === "town" || ds.route.extraAreas[s.area]?.town))
          problems.add(`${s.id}: book reward handed in outside a town (${s.area}) with ${JSON.stringify(o)}`);
      }
    }
    expect([...problems]).toEqual([]);
  });

  it("hands in every passive quest on the default route; the bandit hand-in only with Kill all", () => {
    for (const bandit of ["kill", "alira", "kraityn", "oak"] as const) {
      const handIns = new Set(route({ ...FAST_ALL_PASSIVES.options, bandit }).flatMap((s) => (s.kind === "hand-in" ? (s.quests ?? []).map((q) => q.id) : [])));
      for (const r of PASSIVE_REWARDS) {
        if (r.type === "bandit-choice") expect(handIns.has(r.questId!)).toBe(bandit === "kill");
        else expect(handIns.has(r.questId!), `${r.quest} with ${bandit}`).toBe(true);
      }
    }
  });

  it("includes the twelve Trials of Ascendancy and three Labyrinths only when trials are on", () => {
    expect(route().filter((s) => s.kind === "trial")).toHaveLength(12);
    expect(route({ ...FAST_ALL_PASSIVES.options, trials: false }).filter((s) => s.kind === "trial")).toHaveLength(0);
    expect(route().filter((s) => s.kind === "labyrinth").map((s) => s.labyrinth)).toEqual(["normal", "cruel", "merciless"]);
    expect(route({ ...FAST_ALL_PASSIVES.options, trials: false }).some((s) => s.labTrip || s.to === "Labyrinth_Airlock")).toBe(false);
  });

  it("helping a bandit takes The Apex from that bandit", () => {
    const text = route({ ...FAST_ALL_PASSIVES.options, bandit: "oak" }).map((s) => s.text).join("\n");
    expect(text).toMatch(/help Oak, Skullbreaker, take The Apex/);
    expect(text).not.toMatch(/Kill Kraityn.*\n(.*\n)*.*Help Kraityn/);
  });
});

describe("progress", () => {
  it("following the whole route reaches the end; travel steps are detected, objectives only passed", () => {
    const steps = route();
    const p = progress(steps, walk(steps));
    const lastArrival = steps.findLastIndex((s) => s.to);
    expect(p.cursor).toBe(lastArrival + 1); // what follows the last area entry can only be confirmed by hand
    for (const [k, s] of steps.entries()) {
      if (k >= p.cursor) break;
      expect(p.steps[k]!.status, s.id).toBe(s.to ? "done" : "passed");
    }
    expect(p.steps.some((s) => s.evidence === "confirmed")).toBe(false); // nothing is "done" without the player
  });

  it("entering an area doesn't complete the objective there", () => {
    const steps = route();
    const p = progress(steps, [zone("1_1_1", 1)]);
    expect(p.cursor).toBe(0); // "Find and kill Hillock" is still current
    expect(p.steps[0]!.status).toBe("current");
    expect(p.position).toMatchObject({ kind: "on-route", areaId: "1_1_1" });
  });

  it("a town visit doesn't move the guide", () => {
    const steps = route();
    const coast = steps.findIndex((s) => s.to === "1_1_2");
    const before = progress(steps, walk(steps, 0, coast + 1));
    const after = progress(steps, [...walk(steps, 0, coast + 1), zone("1_1_town", 5000)]);
    expect(after.cursor).toBe(before.cursor);
    expect(after.position.kind).toBe("town-visit");
  });

  it("entering a later area of the act skips ahead without resetting; skipped steps are only passed", () => {
    const steps = route();
    const ledge = steps.findIndex((s) => s.to === "1_1_5"); // The Ledge
    const p = progress(steps, [zone("1_1_1", 1), zone("1_1_town", 2), zone("1_1_5", 3)]);
    expect(p.cursor).toBe(ledge + 1);
    expect(p.steps[ledge]!.status).toBe("done");
    expect(p.steps.slice(2, ledge).every((s) => s.status === "passed" || s.status === "done")).toBe(true);
  });

  it("backtracking is off route and keeps the guide; coming back resumes", () => {
    const steps = route();
    const climb = steps.findIndex((s) => s.to === "1_1_6");
    const events = walk(steps, 0, climb + 1);
    const at = progress(steps, events).cursor;
    const back = progress(steps, [...events, zone("1_1_3", 9000)]); // The Mud Flats again
    expect(back.cursor).toBe(at);
    expect(back.position).toMatchObject({ kind: "off-route", areaId: "1_1_3" });
    const resumed = progress(steps, [...events, zone("1_1_3", 9000), zone("1_1_6", 9001)]);
    expect(resumed.cursor).toBe(at);
    expect(resumed.position.kind).toBe("on-route");
  });

  it("going back to the area you are working in doesn't skip ahead to a later step there", () => {
    const steps = route();
    // Seen in a real log: The Crossroads → town → The Old Fields → The Crossroads, before The Chamber of Sins.
    const upTo = walk(steps, 0, steps.findIndex((s) => s.to === "1_2_3") + 1);
    const at = progress(steps, upTo).cursor;
    const p = progress(steps, [...upTo, zone("1_2_town", 90000), zone("1_2_2", 90001), zone("1_2_3", 90002)]);
    expect(p.cursor).toBe(at);
    expect(p.position.kind).toBe("on-route");
  });

  it("a hideout or map is outside the campaign", () => {
    const p = progress(route(), [zone("1_1_1", 1), zone("HideoutBeach", 2)]);
    expect(p.position).toMatchObject({ kind: "outside", areaId: "HideoutBeach" });
    expect(p.cursor).toBe(0);
  });

  it("a log that starts mid-campaign jumps to the act it shows", () => {
    const steps = route();
    const p = progress(steps, [zone("2_6_town", 1), zone("2_6_2", 2)]);
    expect(steps[p.cursor]!.act).toBe(6);
    expect(p.position.kind).not.toBe("off-route");
  });

  it("a single stray entry far ahead (another character's login) doesn't move the guide", () => {
    const steps = route();
    // Seen in a real log: a level-2 character's events start with Karui Shores, then The Twilight Strand.
    const p = progress(steps, [
      zone("2_11_endgame_town", 1),
      zone("1_1_1", 2),
      zone("1_1_town", 3),
      zone("1_1_2", 4),
      // the same far-ahead area twice (logging into another character twice) confirms nothing
      zone("2_11_endgame_town", 5),
      zone("HideoutBeach", 6),
      zone("2_11_endgame_town", 7),
      zone("1_1_town", 8),
    ]);
    expect(steps[p.cursor]!.act).toBe(1);
    expect(p.position.kind).toBe("town-visit");
  });

  it("manual marks: done/skip move the guide, not-done reopens a passed step", () => {
    const steps = route();
    const done = progress(steps, [zone("1_1_1", 1)], [{ objectiveId: stepMarkId(steps[0]!.id), mark: "done", choice: null, at: 2 }]);
    expect(done.steps[0]!.status).toBe("done");
    expect(done.steps[0]!.evidence).toBe("confirmed");
    expect(done.cursor).toBe(1);
    const skipped = progress(steps, [], [{ objectiveId: stepMarkId(steps[0]!.id), mark: "skipped", choice: null, at: 2 }]);
    expect(skipped.steps[0]!.status).toBe("skipped");
    const all = walk(steps, 0, 10);
    const reopened = progress(steps, all, [{ objectiveId: stepMarkId(steps[0]!.id), mark: "not-done", choice: null, at: 99999 }]);
    expect(reopened.steps[0]!).toMatchObject({ status: "pending", reopened: true });
    expect(reopened.cursor).toBe(progress(steps, all).cursor); // the guide doesn't move back
  });

  it("marks of steps that aren't in this profile are ignored", () => {
    const p = progress(route(), [], [{ objectiveId: stepMarkId("a99.999"), mark: "done", choice: null, at: 1 }]);
    expect(p.cursor).toBe(0);
  });

  it("is deterministic: the same events give the same progress (restart / resume)", () => {
    const steps = route();
    const events = walk(steps, 0, 120);
    expect(JSON.stringify({ ...progress(steps, events), visited: [] })).toBe(JSON.stringify({ ...progress(steps, events), visited: [] }));
  });

  it("each bandit option can be followed to the end of Act 2", () => {
    for (const bandit of ["kill", "alira", "kraityn", "oak"] as const) {
      const steps = route({ ...FAST_ALL_PASSIVES.options, bandit });
      const endA2 = steps.findIndex((s) => s.act === 3);
      const p = progress(steps, walk(steps, 0, endA2));
      expect(p.cursor, bandit).toBe(steps.slice(0, endA2).findLastIndex((s) => s.to) + 1);
    }
  });
});

// Real-log check (opt-in): VAALYTICS_POE1_LOG=<Client.txt> npx vitest run act-tracker
// Splits the log into campaign runs (a new character on The Twilight Strand → Karui Shores) and follows each one
// with the default guide; party members' lines don't matter here (only area entries are used).
const LOG = process.env.VAALYTICS_POE1_LOG;
describe.skipIf(!LOG)("real PoE 1 Client.txt", () => {
  it("finished campaign runs reach the end of the route; off-route entries stay few", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(LOG!, "utf8");
    const runs: CampaignEventRow[][] = [];
    let run: CampaignEventRow[] | null = null;
    let t = 0;
    for (const m of text.matchAll(/Generating level (\d+) area "([^"]+)"/g)) {
      const id = m[2]!;
      if (id === "1_1_1" && Number(m[1]) === 1) {
        run = [];
        runs.push(run);
      }
      run?.push(zone(id, ++t));
    }
    // A real campaign run has hundreds of area entries; a handful of entries ending in Karui Shores is a login to a
    // character who finished long ago (not a run).
    // The run ends at Karui Shores reached from Act 10 (a stray Karui Shores entry from a login doesn't count).
    const endOf = (r: CampaignEventRow[]) => r.findIndex((e, k) => e.areaId === "2_11_endgame_town" && !!r[k - 1]?.areaId?.startsWith("2_10_"));
    const finished = runs.filter((r) => r.length >= 100 && endOf(r) >= 0);
    const report: string[] = [];
    for (const r of finished) {
      const end = endOf(r);
      const events = r.slice(0, end + 1);
      let best: { bandit: string; cursor: number; off: number; steps: number; last: number; detected: string } | null = null;
      for (const bandit of ["kill", "alira", "kraityn", "oak"] as const) {
        const steps = route({ ...FAST_ALL_PASSIVES.options, bandit, trials: false });
        let off = 0;
        for (let k = 1; k <= events.length; k++) if (progress(steps, events.slice(0, k)).position.kind === "off-route") off++;
        const p = progress(steps, events);
        const last = steps.findLastIndex((s) => s.to) + 1;
        const moves = steps.filter((s) => s.to);
        const seen = moves.filter((s) => p.steps[s.index]!.evidence === "area-entered").length;
        if (!best || p.cursor > best.cursor) best = { bandit, cursor: p.cursor, off, steps: steps.length, last, detected: `${seen}/${moves.length}` };
      }
      report.push(`${events.length} entries → ${best!.bandit}: cursor ${best!.cursor}/${best!.last}, off-route ${best!.off}, moves detected ${best!.detected}`);
      expect(best!.cursor).toBe(best!.last);
    }
    console.info(`runs: ${runs.length}, finished: ${finished.length}\n${report.join("\n")}`);
    expect(finished.length).toBeGreaterThan(0);
  }, 120_000);
});

describe("overlay view", () => {
  it("the current objective runs from the current step to the move to the next location", async () => {
    const { currentObjective, nextSteps, actProgress } = await import("./engine/view");
    const steps = route();
    const p = progress(steps, [zone("1_1_1", 1), zone("1_1_town", 2), zone("1_1_2", 3), zone("1_1_3", 4)]); // The Mud Flats
    const o = currentObjective(steps, p)!;
    expect(o.area).toBe("1_1_3");
    expect(o.steps[0]!.text).toBe("Find 3× Glyph");
    expect(o.nextLocation).toBe("1_1_4_1"); // The Submerged Passage
    expect(nextSteps(steps, p, 3).map((x) => x.tag)).toEqual(["CURRENT", "NEXT", "UPCOMING"]);
    const a = actProgress(steps, p)!;
    expect(a.act).toBe(1);
    expect(a.done).toBe(p.cursor);
    expect(a.total).toBe(steps.filter((s) => s.act === 1).length);
  });

  it("preferences are validated; anything malformed falls back to the defaults", async () => {
    const { DEFAULT_PREFS, isTrackerPrefs } = await import("./prefs");
    expect(isTrackerPrefs(DEFAULT_PREFS)).toBe(true);
    expect(isTrackerPrefs({ ...DEFAULT_PREFS, opacity: 0.2 })).toBe(false);
    expect(isTrackerPrefs({ ...DEFAULT_PREFS, options: { ...DEFAULT_PREFS.options, bandit: "eramir" } })).toBe(false);
    expect(isTrackerPrefs({ ...DEFAULT_PREFS, characterId: 1.5 })).toBe(false);
    expect(isTrackerPrefs(null)).toBe(false);
  });
});

describe("passive skill point guardian", () => {
  const ev = (kind: CampaignEventRow["kind"], at: number, extra: Partial<CampaignEventRow> = {}): CampaignEventRow => ({
    at, kind, areaId: null, areaName: null, areaLevel: null, amount: null, detail: null, ...extra,
  });
  const passivesOutput = (at: number, quests: [string, number][], level = 10) => [
    ev("passives", at, { amount: level + quests.reduce((n, q) => n + q[1], 0), detail: `total:${level}` }),
    ev("passives", at, { amount: level, detail: "level" }),
    ev("passives", at, { amount: quests.reduce((n, q) => n + q[1], 0), detail: "quests" }),
    ...quests.map(([q, n]) => ev("passives", at, { amount: n, detail: `quest:${q}` })),
  ];
  const run = async (events: CampaignEventRow[], opts: { bandit?: BanditChoice; marks?: CampaignMark[]; rewardMarks?: import("@/core/ipc/commands").CampaignRewardMark[] } = {}) => {
    const { guardian } = await import("./engine/guardian");
    const steps = route({ ...FAST_ALL_PASSIVES.options, bandit: opts.bandit ?? "kill" });
    const p = progress(steps, events, opts.marks ?? []);
    const name = (id: string | null) => (id ? (ds.areas.get(id)?.name ?? id) : "?");
    return guardian({ rewards: ds.rewards, steps, progress: p, events, rewardMarks: opts.rewardMarks ?? [], bandit: opts.bandit ?? "kill", name });
  };
  const status = (r: Awaited<ReturnType<typeof run>>, quest: string) => r.rewards.find((x) => x.reward.quest === quest && x.reward.type !== "pantheon")!;

  it("a fresh character: everything available, 24 expected, nothing missed", async () => {
    const r = await run([zone("1_1_1", 1)]);
    expect(r.passive).toMatchObject({ expected: 24, completed: 0, fromPassives: null, receivedInLog: 0 });
    expect(r.rewards.filter((x) => x.reward.type === "passive-points").every((x) => x.status === "AVAILABLE")).toBe(true);
    expect(r.warnings.filter((w) => w.severity !== "info")).toEqual([]);
  });

  it("entering the objective area is only IN PROGRESS, never completed", async () => {
    const steps = route();
    const upTo = walk(steps, 0, steps.findIndex((s) => s.to === "1_1_4_0") + 1); // The Flooded Depths
    const s = status(await run(upTo), "The Dweller of the Deep");
    expect(s.status).toBe("IN_PROGRESS");
    expect(s.stages).toMatchObject({ areaEntered: "log", objectiveCompleted: null, questTurnedIn: null, rewardClaimed: null });
  });

  it("a point received in the hand-in town is matched to the quest handed in there", async () => {
    const steps = route();
    const hand = steps.findIndex((s) => s.kind === "hand-in" && s.quests?.some((q) => q.id === "a1q7"));
    const events = [...walk(steps, 0, hand), ev("passive_points", 5000, { amount: 1 })];
    const s = status(await run(events), "The Dweller of the Deep");
    expect(s.status).toBe("COMPLETED");
    expect(s.stages.rewardClaimed).toBe("log");
    expect(s.reason).toMatch(/Lioneye's Watch/);
  });

  it("/passives is the exact answer: listed > 0 claimed, 0 = point not received yet, missing = missed", async () => {
    const steps = route();
    const pastAct1 = walk(steps, 0, steps.findIndex((s) => s.act === 2));
    const events = [...pastAct1, ...passivesOutput(90000, [["The Dweller of the Deep", 1], ["The Marooned Mariner", 0]])];
    const r = await run(events);
    expect(status(r, "The Dweller of the Deep")).toMatchObject({ status: "COMPLETED", stages: { rewardClaimed: "passives" } });
    const mariner = status(r, "The Marooned Mariner");
    expect(mariner.status).toBe("AVAILABLE");
    expect(mariner.reason).toMatch(/talk to Bestel/);
    expect(r.warnings.some((w) => w.kind === "unclaimed" && w.rewardId === mariner.reward.id)).toBe(true);
    expect(r.passive.fromPassives).toBe(1);
    expect(r.snapshot?.quests.size).toBe(2);
  });

  it("past a hand-in with no point in the log = NEEDS CONFIRMATION; MISSED only when /passives says so", async () => {
    const steps = route();
    const events = walk(steps, 0, steps.findIndex((s) => s.act === 2));
    const s = status(await run(events), "The Dweller of the Deep");
    expect(s.status).toBe("NEEDS_CONFIRMATION");
    expect(s.reason).toMatch(/\/passives/);
    const r = await run([...events, ...passivesOutput(999999, [["The Marooned Mariner", 1]])]);
    const missed = status(r, "The Dweller of the Deep");
    expect(missed.status).toBe("MISSED");
    expect(r.warnings.some((w) => w.kind === "missed" && w.rewardId === missed.reward.id)).toBe(true);
  });

  it("a confirmed reward mark completes it; the log alone never claims a Pantheon soul", async () => {
    const steps = route();
    const events = walk(steps, 0, steps.findIndex((s) => s.act === 7));
    const r = await run(events, { rewardMarks: [{ rewardId: "passive.a1q7", stage: "complete", choice: null, at: 99999 }] });
    expect(status(r, "The Dweller of the Deep")).toMatchObject({ status: "COMPLETED", stages: { rewardClaimed: "you" } });
    const brine = r.rewards.find((x) => x.reward.pantheon?.god === "Soul of The Brine King")!;
    expect(brine.status).toBe("NEEDS_CONFIRMATION");
    expect(brine.stages.rewardClaimed).toBeNull();
  });

  it("bandits: helping one expects 23 and doesn't warn; /passives 0 with Kill all warns", async () => {
    const oak = await run([zone("1_1_1", 1)], { bandit: "oak" });
    expect(oak.passive.expected).toBe(23);
    expect(oak.rewards.find((x) => x.reward.type === "bandit-choice")!.notExpected).toBe(true);
    const kill = await run([zone("1_1_1", 1), ...passivesOutput(500, [["Deal with the Bandits", 0]])]);
    expect(kill.warnings.some((w) => w.kind === "bandit")).toBe(true);
  });

  it("warns when /passives and the tracker disagree, and when /passives is older than the last point", async () => {
    const steps = route();
    const hand = steps.findIndex((s) => s.kind === "hand-in" && s.quests?.some((q) => q.id === "a1q7"));
    const events = [...walk(steps, 0, hand), ...passivesOutput(4000, []), ev("passive_points", 5000, { amount: 1 })];
    const r = await run(events);
    expect(r.warnings.map((w) => w.kind)).toEqual(expect.arrayContaining(["mismatch", "stale-snapshot"]));
  });

  it("An End to Hunger's 2-point grant only matches An End to Hunger", async () => {
    const steps = route();
    const end = steps.findIndex((s) => s.kind === "hand-in" && s.quests?.some((q) => q.id === "a10q3"));
    const events = [...walk(steps, 0, end), ev("passive_points", 99999, { amount: 2 })];
    const r = await run(events);
    expect(status(r, "An End to Hunger").stages.rewardClaimed).toBe("log");
    expect(status(r, "Vilenta's Vengeance").stages.rewardClaimed).toBeNull();
  });

  it("groups /passives lines into one snapshot per command", async () => {
    const { passivesSnapshots } = await import("./engine/guardian");
    const s = passivesSnapshots([...passivesOutput(100, [["The Dweller of the Deep", 1]]), ...passivesOutput(200, [["The Dweller of the Deep", 1], ["The Marooned Mariner", 1]])]);
    expect(s).toHaveLength(2);
    expect(s[1]!.quests.size).toBe(2);
    expect(s[1]!.fromQuests).toBe(2);
  });

  it("Ascendancy: 6 / 3 / 3 trials per Labyrinth; Labyrinths done per /passives imply their trials", async () => {
    const r = await run([zone("1_1_1", 1)]);
    expect(r.ascendancy.labs.map((l) => [l.lab, l.trials.length, !!l.run])).toEqual([["normal", 6, true], ["cruel", 3, true], ["merciless", 3, true]]);
    expect(r.ascendancy.labs.every((l) => !l.runDone && l.trials.every((t) => !t.done))).toBe(true);
    const done2 = await run([zone("1_1_1", 1), ev("passives", 50, { amount: 4, detail: "ascendancy:4" }), ev("passives", 50, { amount: 0, detail: "quests" })]);
    expect(done2.ascendancy.pointsFromPassives).toBe(4);
    expect(done2.ascendancy.labs.map((l) => l.runDone)).toEqual([true, true, false]);
    expect(done2.ascendancy.labs[0]!.trials.every((t) => t.done && t.evidence === "implied: Labyrinth completed")).toBe(true);
  });
});

// Real-log check of the guardian (opt-in, same variable): for every full campaign run followed by a /passives
// output, run the guardian WITHOUT the /passives lines (only area entries and point grants) and compare with what
// the game printed. Claimed quests the guardian calls MISSED would be false alarms.
describe.skipIf(!LOG)("real PoE 1 Client.txt — guardian vs /passives", () => {
  it("point grants are matched to the quests /passives lists; no false MISSED", async () => {
    const { readFileSync } = await import("node:fs");
    const { guardian } = await import("./engine/guardian");
    const lines = readFileSync(LOG!, "utf8").split(/\r?\n/);
    type Run = { events: CampaignEventRow[]; truth: Map<string, number> | null };
    const runs: Run[] = [];
    let cur: Run | null = null;
    let ended = false;
    let truth: Map<string, number> | null = null;
    let t = 0;
    for (const l of lines) {
      const g = l.match(/Generating level (\d+) area "([^"]+)"/);
      if (g) {
        if (g[2] === "1_1_1" && g[1] === "1") {
          cur = { events: [], truth: null };
          runs.push(cur);
          ended = false;
        }
        if (cur && !ended) {
          cur.events.push(zone(g[2]!, ++t));
          if (g[2] === "2_11_endgame_town" && cur.events.at(-2)?.areaId?.startsWith("2_10_")) ended = true;
        }
        continue;
      }
      if (!cur) continue;
      const p = l.match(/\] : You have received (a|\d+) Passive Skill Points?\./);
      if (p && !ended) cur.events.push({ at: ++t, kind: "passive_points", areaId: null, areaName: null, areaLevel: null, amount: p[1] === "a" ? 1 : Number(p[1]), detail: null });
      if (ended && /\] : \d+ Passive Skill Points from quests:/.test(l)) truth = new Map();
      const q = l.match(/\] : \((\d+) from ([^)]+)\)$/);
      if (ended && q && truth) {
        truth.set(q[2]!, Number(q[1]));
        cur.truth = truth;
      }
      if (ended && !q && truth && !/Passive Skill Points from|total .* Points/.test(l)) truth = null;
    }
    const report: string[] = [];
    let falseMissed = 0;
    for (const r of runs.filter((x) => x.truth && x.events.length >= 100)) {
      const bandit: BanditChoice = r.truth!.get("Deal with the Bandits") === 1 ? "kill" : "oak";
      const steps = route({ ...FAST_ALL_PASSIVES.options, bandit, trials: false });
      const p = progress(steps, r.events);
      const name = (id: string | null) => (id ? (ds.areas.get(id)?.name ?? id) : "?");
      const g = guardian({ rewards: ds.rewards, steps, progress: p, events: r.events, rewardMarks: [], bandit, name });
      const claimed = [...r.truth!].filter(([, n]) => n > 0).map(([q]) => q);
      const matched = claimed.filter((q) => g.rewards.find((x) => x.reward.quest === q && x.reward.type !== "pantheon")?.stages.rewardClaimed === "log");
      const missedButClaimed = claimed.filter((q) => g.rewards.find((x) => x.reward.quest === q && x.reward.type !== "pantheon")?.status === "MISSED");
      falseMissed += missedButClaimed.length;
      report.push(`${r.events.length} entries: /passives ${claimed.length} claimed · matched from log ${matched.length} · false MISSED ${missedButClaimed.length} [${missedButClaimed.join(", ")}] · log points ${g.passive.receivedInLog}`);
    }
    console.info(`guardian vs /passives\n${report.join("\n")}`);
    expect(report.length).toBeGreaterThan(0);
    expect(falseMissed).toBe(0);
  }, 120_000);
});

describe("route intelligence", () => {
  const prio = async (o: GuideOptions = FAST_ALL_PASSIVES.options) => {
    const { prioritise } = await import("./engine/priorities");
    const steps = route(o);
    return { steps, p: prioritise(steps, ds.route, ds.rewards) };
  };

  it("every passive and respec hand-in on the route is PERMANENT POWER; trials and Labyrinths are ASCENDANCY", async () => {
    const { steps, p } = await prio({ ...FAST_ALL_PASSIVES.options, leagueStartExtras: true });
    const books = new Set(ds.rewards.filter((r) => r.type === "passive-points" || r.type === "respec-points").map((r) => r.questId));
    for (const s of steps)
      if (s.kind === "hand-in" && s.quests?.some((q) => books.has(q.id))) expect(p[s.index]!.priority, s.text).toBe("PERMANENT_POWER");
    for (const s of steps) if (s.kind === "trial" || s.kind === "labyrinth" || s.labTrip) expect(p[s.index]!.priority, s.text).toBe("ASCENDANCY");
    expect(p[steps.find((s) => s.kills?.some((k) => k.includes("Brine King")))!.index]!.priority).toBe("IMPORTANT");
    expect(p[steps.find((s) => s.kind === "crafting")!.index]!.priority).toBe("SKIP");
    expect(p[steps.find((s) => s.kills?.includes("Alira Darktongue"))!.index]!.priority).toBe("IMPORTANT"); // bandit, not The Way Forward
    expect(p[steps.find((s) => s.kills?.includes("Captain Arteri"))!.index]!.priority).toBe("PERMANENT_POWER");
    expect(p[steps.find((s) => s.text === "Hand in Enemy at the Gate")!.index]!.priority).toBe("BUILD_OPTIONAL");
    const counts: Record<string, number> = {};
    for (const x of p) counts[x.priority] = (counts[x.priority] ?? 0) + 1;
    console.info("priorities (league-start route):", JSON.stringify(counts));
  });

  it("'important only' hides only optional steps, never a move, and the guide still follows the whole route", async () => {
    const { isImportantStep } = await import("./engine/priorities");
    const { currentObjective, nextSteps } = await import("./engine/view");
    const { steps, p } = await prio();
    const show = (s: ResolvedStep) => isImportantStep(p[s.index]!);
    const hidden = steps.filter((s) => !s.to && !show(s));
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((s) => ["BUILD_OPTIONAL", "SKIP"].includes(p[s.index]!.priority))).toBe(true);
    // Twilight Strand → town: the visit in town shows no gem hand-in.
    const pr = progress(steps, [zone("1_1_1", 1), zone("1_1_town", 2)]);
    expect(currentObjective(steps, pr, 6, show)!.steps.map((s) => s.text)).not.toContain("Hand in Enemy at the Gate");
    expect(currentObjective(steps, pr)!.steps.map((s) => s.text)).toContain("Hand in Enemy at the Gate");
    expect(nextSteps(steps, pr, 5, show).every((x) => x.step.to || show(x.step))).toBe(true);
    expect(progress(steps, walk(steps)).cursor).toBe(steps.findLastIndex((s) => s.to) + 1);
  });

  it("a visit that ends in town lists the hand-ins done there on one trip", async () => {
    const { currentObjective, townVisitAfter } = await import("./engine/view");
    const steps = route();
    const lower = steps.findIndex((s) => s.to === "1_1_7_1"); // The Lower Prison, then waypoint to town
    const pr = progress(steps, walk(steps, 0, lower + 1));
    const isTown = (id: string) => ds.areas.get(id)?.kind === "town";
    const visit = townVisitAfter(steps, currentObjective(steps, pr), isTown);
    expect(visit?.town).toBe("1_1_town");
    expect(visit!.handIns.flatMap((h) => h.quests!.map((q) => q.name))).toEqual(expect.arrayContaining(["The Dweller of the Deep"]));
  });

  it("way back: off route → the shortest way to the guide's area; from the hideout → a waypoint first", async () => {
    const { wayBack } = await import("./engine/recovery");
    const steps = route();
    const climb = steps.findIndex((s) => s.to === "1_1_6");
    const events = [...walk(steps, 0, climb + 1), zone("1_1_5", 9000)]; // back to The Ledge
    const pr = progress(steps, events);
    expect(pr.position.kind).toBe("off-route");
    const w = wayBack(ds.areas, pr.visited, pr.position, steps[pr.cursor]!.area);
    expect(w?.path[0]).toBe("1_1_5");
    expect(w?.path.at(-1)).toBe(steps[pr.cursor]!.area);
    const out = progress(steps, [...walk(steps, 0, climb + 1), zone("HideoutBeach", 9000)]);
    const w2 = wayBack(ds.areas, out.visited, out.position, steps[out.cursor]!.area);
    expect(w2?.viaWaypoint).toBe(true);
    expect(w2?.path.at(-1)).toBe(steps[out.cursor]!.area);
    expect(wayBack(ds.areas, pr.visited, { kind: "on-route", areaId: "1_1_6", at: 1 }, "1_1_6")).toBeNull();
  });

  it("return trips only for points the evidence says are missing or not taken — never for 'needs confirmation'", async () => {
    const { guardian } = await import("./engine/guardian");
    const { returnTrips } = await import("./engine/recovery");
    const steps = route();
    const act3 = walk(steps, 0, steps.findIndex((s) => s.to === "1_3_town") + 1);
    const ev = (n: number, quest: string): CampaignEventRow => ({ at: 99999, kind: "passives", areaId: null, areaName: null, areaLevel: null, amount: n, detail: `quest:${quest}` });
    const events = [...act3, { at: 99999, kind: "passives" as const, areaId: null, areaName: null, areaLevel: null, amount: 1, detail: "quests" }, ev(1, "The Dweller of the Deep"), ev(0, "The Marooned Mariner")];
    const pr = progress(steps, events);
    const name = (id: string | null) => id ?? "";
    const g = guardian({ rewards: ds.rewards, steps, progress: pr, events, rewardMarks: [], bandit: "kill", name });
    const trips = returnTrips(g, ds.areas, pr.visited, pr.position, 3);
    const byQuest = new Map(trips.map((t) => [t.reward.reward.quest, t]));
    expect(byQuest.get("The Marooned Mariner")).toMatchObject({ purpose: "hand-in", target: "1_1_town" });
    expect(byQuest.get("The Marooned Mariner")!.plan).not.toBeNull();
    expect(byQuest.has("The Dweller of the Deep")).toBe(false); // claimed
    // The Way Forward / Through Sacred Ground are only "needs confirmation" here (no point line, no /passives line).
    const wf = g.rewards.find((r) => r.reward.quest === "The Way Forward")!;
    if (wf.status === "NEEDS_CONFIRMATION") expect(byQuest.has("The Way Forward")).toBe(false);
  });

  it("older stored preferences keep their values when new options are added", async () => {
    const { normalizePrefs } = await import("./prefs");
    const old = { options: { bandit: "oak", trials: false, leagueStartExtras: false, library: true }, compact: true, opacity: 0.7, characterId: 3, hints: false };
    expect(normalizePrefs(old)).toMatchObject({ ...old, importantOnly: false });
    expect(normalizePrefs({ ...old, opacity: 5 }).opacity).toBe(0.92);
  });
});

describe("campaign timer", () => {
  const timer = async () => import("./engine/timer");
  /** A run following the route, one area entry every `step` seconds. */
  const timedWalk = (steps: readonly ResolvedStep[], step = 60, t0 = 1000) =>
    steps.flatMap((s) => (s.to ? [s.to] : [])).map((to, k) => zone(to, t0 + k * step));

  it("a whole run from The Twilight Strand: every act timed, finished at Karui Shores", async () => {
    const { campaignTimes } = await timer();
    const steps = route();
    const events = [zone("1_1_1", 940), ...timedWalk(steps)];
    const t = campaignTimes(events, ds.areas, ds.route);
    expect(t.fromStart).toBe(true);
    expect(t.finishedAt).not.toBeNull();
    expect(t.acts.map((a) => a.act)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(t.acts.every((a) => a.timed && a.finishedAt !== null)).toBe(true);
    // every gap is 60 s and below the break gap: total = time from start to Karui Shores
    expect(t.campaignSeconds).toBe(t.finishedAt! - t.startedAt!);
    expect(t.acts.reduce((n, a) => n + a.activeSeconds, 0)).toBe(t.campaignSeconds);
    expect(t.townSeconds).toBeGreaterThan(0);
    expect(t.averageAreaSeconds).toBeGreaterThan(0);
    expect(t.current).toBeNull();
  });

  it("a gap longer than 30 minutes is a break, not play time", async () => {
    const { campaignTimes } = await timer();
    const t = campaignTimes([zone("1_1_1", 0), zone("1_1_town", 600), zone("1_1_2", 600 + 3 * 3600)], ds.areas, ds.route);
    expect(t.campaignSeconds).toBe(600);
    expect(t.breaks).toBe(1);
  });

  it("time away goes to the first area outside the campaign: hideout vs away", async () => {
    const { campaignTimes } = await timer();
    const t = campaignTimes(
      [zone("1_1_1", 0), zone("1_1_town", 100), zone("HideoutBeach", 200), zone("1_1_town", 500), zone("1_Labyrinth_boss_1", 600), zone("1_1_2", 1000)],
      ds.areas,
      ds.route,
    );
    expect(t.hideoutSeconds).toBe(300);
    expect(t.awaySeconds).toBe(400);
    expect(t.townSeconds).toBe(200);
    expect(t.acts[0]!.activeSeconds).toBe(1000); // away time while in Act 1 counts towards Act 1
  });

  it("a log that starts mid-campaign doesn't time the act it starts in", async () => {
    const { campaignTimes } = await timer();
    const steps = route();
    const a3 = steps.findIndex((s) => s.to === "1_3_1");
    const a5 = steps.findIndex((s) => s.act === 5);
    const t = campaignTimes(timedWalk(steps.slice(a3, a5 + 1)), ds.areas, ds.route);
    expect(t.fromStart).toBe(false);
    expect(t.acts.find((a) => a.act === 3)!.timed).toBe(false);
    expect(t.acts.find((a) => a.act === 4)!.timed).toBe(false); // the act before wasn't timed
  });

  it("live timer only while the last event is recent; durations formatted", async () => {
    const { campaignTimes, liveExtra, formatDuration } = await timer();
    const t = campaignTimes([zone("1_1_1", 0), zone("1_1_town", 100)], ds.areas, ds.route);
    expect(t.current?.area).toBe("1_1_town");
    expect(liveExtra(t, 160)).toBe(60);
    expect(liveExtra(t, 100 + 2 * 3600)).toBe(0);
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("best act times across runs use timed acts only", async () => {
    const { campaignTimes, bestActs } = await timer();
    const steps = route();
    const fast = campaignTimes([zone("1_1_1", 940), ...timedWalk(steps, 30)], ds.areas, ds.route);
    const slow = campaignTimes([zone("1_1_1", 940), ...timedWalk(steps, 90)], ds.areas, ds.route);
    const run = (characterId: number, times: typeof fast) => ({ characterId, name: `c${characterId}`, class: "Witch", level: 70, times, pointsInLog: 0, pointsFromPassives: null, deaths: 0, skipped: 0, confirmed: 0 });
    const best = bestActs([run(1, slow), run(2, fast)]);
    expect(best.every((b) => b.best?.characterId === 2)).toBe(true);
  });
});

describe.skipIf(!LOG)("real PoE 1 Client.txt — timer", () => {
  it("full campaign runs are timed act by act with plausible totals", async () => {
    const { readFileSync } = await import("node:fs");
    const { campaignTimes, formatDuration } = await import("./engine/timer");
    const { parseStamp } = { parseStamp: (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16), +s.slice(17, 19)) / 1000 };
    const runs: CampaignEventRow[][] = [];
    let run: CampaignEventRow[] | null = null;
    for (const l of readFileSync(LOG!, "utf8").split(/\r?\n/)) {
      const g = l.match(/^(\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d) .*Generating level (\d+) area "([^"]+)"/);
      if (!g) continue;
      if (g[3] === "1_1_1" && g[2] === "1") runs.push((run = []));
      run?.push(zone(g[3]!, parseStamp(g[1]!)));
    }
    const report: string[] = [];
    for (const r of runs.filter((x) => x.length >= 100)) {
      const t = campaignTimes(r, ds.areas, ds.route);
      if (!t.finishedAt) continue;
      report.push(`${formatDuration(t.campaignSeconds)} total, ${t.acts.filter((a) => a.timed).length}/10 acts timed, town ${formatDuration(t.townSeconds)}, away ${formatDuration(t.hideoutSeconds + t.awaySeconds)}, breaks ${t.breaks}, avg area ${formatDuration(t.averageAreaSeconds ?? 0)}`);
      expect(t.campaignSeconds).toBeGreaterThan(2 * 3600);
      expect(t.campaignSeconds).toBeLessThan(40 * 3600);
    }
    console.info(`timer (zone entries only)\n${report.join("\n")}`);
    expect(report.length).toBeGreaterThan(0);
  }, 120_000);
});

describe("location atlas integration", () => {
  it("areaGuide lists the route's steps, rewards and route moves for an area", async () => {
    const { areaGuide } = await import("./engine/area");
    const { prioritise } = await import("./engine/priorities");
    const { guardian } = await import("./engine/guardian");
    const steps = route();
    const pr = progress(steps, walk(steps, 0, steps.findIndex((s) => s.to === "1_1_4_0") + 1)); // in The Flooded Depths
    const p = prioritise(steps, ds.route, ds.rewards);
    const g = guardian({ rewards: ds.rewards, steps, progress: pr, events: [], rewardMarks: [], bandit: "kill", name: (id) => id ?? "" });
    const depths = areaGuide("1_1_4_0", steps, pr, p, g);
    expect(depths.isGuideArea).toBe(true);
    expect(depths.steps.some((x) => x.current && x.step.text.includes("The Dweller of the Deep"))).toBe(true);
    expect(depths.rewards.map((r) => [r.state.reward.quest, r.role])).toEqual([["The Dweller of the Deep", "objective"]]);
    expect(depths.routeIn).toContain("1_1_4_1");
    const town = areaGuide("1_1_town", steps, pr, p, g);
    expect(town.rewards.some((r) => r.role === "hand-in" && r.state.reward.quest === "The Dweller of the Deep")).toBe(true);
    expect(town.isGuideArea).toBe(false);
    const nowhere = areaGuide("1_1_3a", steps, pr, p, g); // The Fetid Pool: not on the route
    expect(nowhere.steps).toEqual([]);
    expect(nowhere.rewards.map((r) => r.state.reward.quest)).toEqual(["A Dirty Job"]);
  });
});

describe("guide editor", () => {
  const eng = async () => import("./engine/profiles");

  it("no edits = exactly the built-in route; the built-in route is never changed by a profile", async () => {
    const { applyProfile, EMPTY_EDITS } = await eng();
    const base = route();
    const a = applyProfile(ds.route, FAST_ALL_PASSIVES.options, EMPTY_EDITS, ds.areas);
    expect(a.steps.map((s) => s.id)).toEqual(base.map((s) => s.id));
    const edited = applyProfile(ds.route, FAST_ALL_PASSIVES.options, { ...EMPTY_EDITS, hidden: [base[0]!.id] }, ds.areas);
    expect(edited.hidden.has(base[0]!.id)).toBe(true);
    expect(route().map((s) => s.id)).toEqual(base.map((s) => s.id)); // shipped route untouched
  });

  it("moves stay within a visit, custom steps keep positions consistent, the route is still followed to the end", async () => {
    const { applyProfile, moveEdit, EMPTY_EDITS, canMoveAfter } = await eng();
    const steps = route();
    // The Mud Flats visit: "Find 3× Glyph" then "→ The Submerged Passage"; a move can't cross the move out.
    const glyph = steps.findIndex((s) => s.text === "Find 3× Glyph");
    expect(moveEdit(steps, glyph, 1)).toBeNull();
    const town = steps.findIndex((s) => s.kind === "hand-in" && s.quests?.some((q) => q.id === "a1q7"));
    const down = moveEdit(steps, town, 1);
    expect(down).not.toBeNull();
    expect(canMoveAfter(steps, glyph, town)).toBe(false); // other visit
    const edits = { ...EMPTY_EDITS, moves: [down!], custom: [{ id: "custom.a", after: steps[town]!.id, text: "Buy a Quicksilver Flask" }], priorities: { [steps[glyph]!.id]: "SKIP" as const } };
    const a = applyProfile(ds.route, FAST_ALL_PASSIVES.options, edits, ds.areas);
    expect(a.stale).toBe(0);
    const ids = a.steps.map((s) => s.id);
    expect(ids.indexOf(steps[town]!.id)).toBe(ids.indexOf(down!.after) + 1);
    const custom = a.steps.find((s) => s.id === "custom.a")!;
    expect(custom.area).toBe(steps[town]!.area);
    expect(a.steps.every((s, k) => s.index === k)).toBe(true);
    for (let k = 1; k < a.steps.length; k++) expect(a.steps[k]!.area, a.steps[k]!.id).toBe(a.steps[k - 1]!.to ?? a.steps[k - 1]!.area);
    expect(progress(a.steps, walk(a.steps)).cursor).toBe(a.steps.findLastIndex((s) => s.to) + 1);
    expect(a.priorities.get(steps[glyph]!.id)).toBe("SKIP");
  });

  it("moves can't be hidden; edits for steps not in this route are counted as stale", async () => {
    const { applyProfile, EMPTY_EDITS } = await eng();
    const steps = route();
    const move = steps.find((s) => s.to)!;
    const a = applyProfile(ds.route, FAST_ALL_PASSIVES.options, { ...EMPTY_EDITS, hidden: [move.id, "a99.999"], custom: [{ id: "custom.b", after: "a99.998", text: "x" }] }, ds.areas);
    expect(a.hidden.size).toBe(0);
    expect(a.stale).toBe(3);
  });

  it("export → import round trip; imports are validated and never trusted", async () => {
    const { exportProfile, importProfile, EMPTY_EDITS } = await eng();
    const p = { id: "user.1", name: "Speed run", options: { ...FAST_ALL_PASSIVES.options, bandit: "alira" as const }, edits: { ...EMPTY_EDITS, hidden: ["a1.003"] }, routeVersion: "abc", createdAt: 1, updatedAt: 1 };
    const text = exportProfile(p, "3.30");
    const r = importProfile(text, 5, "user.2", "abc");
    expect(r.ok && r.profile).toMatchObject({ id: "user.2", name: "Speed run", options: { bandit: "alira" }, edits: { hidden: ["a1.003"] } });
    expect(importProfile(text, 5, "user.2", "def")).toMatchObject({ ok: true, warnings: [expect.stringMatching(/another route version/)] });
    expect(importProfile("{", 5, "user.2", null)).toMatchObject({ ok: false });
    expect(importProfile(JSON.stringify({ format: "x" }), 5, "user.2", null)).toMatchObject({ ok: false });
    const evil = JSON.parse(text);
    evil.profile.edits.custom = [{ id: "custom.x", after: "a1.001", text: "y".repeat(500) }];
    expect(importProfile(JSON.stringify(evil), 5, "user.2", null)).toMatchObject({ ok: false });
    evil.game = "poe2";
    expect(importProfile(JSON.stringify(evil), 5, "user.2", null)).toMatchObject({ ok: false, error: expect.stringMatching(/another game/) });
    expect(importProfile("x".repeat(70 * 1024), 5, "user.2", null)).toMatchObject({ ok: false });
  });

  it("stored profiles are read defensively", async () => {
    const { readProfiles, EMPTY_EDITS } = await eng();
    const good = { id: "user.1", name: "A", options: FAST_ALL_PASSIVES.options, edits: EMPTY_EDITS, routeVersion: null, createdAt: 1, updatedAt: 1 };
    expect(readProfiles([good, { ...good, id: "../x" }, null, "x"])).toEqual([good]);
    expect(readProfiles(null)).toEqual([]);
  });
});
