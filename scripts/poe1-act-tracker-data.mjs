#!/usr/bin/env node
// Generates the Act Tracker (PoE 1) route dataset, Acts 1–10, from licensed sources:
//   - exile-leveling (HeartofPhos, MIT): the levelling route files (common/data/routes/act-N.txt) and quests.json
//     (quest names, hand-in NPCs). The route is parsed into structured steps; the text is rendered with real
//     area / quest names; conditional blocks (#ifdef BANDIT_KILL, LEAGUE_START, LIBRARY …) become step conditions.
//   - RePoE fork world_areas.json (game files): every area id the route mentions is checked against it.
// Output: src/games/poe1/act-tracker/data/<patch>/route.json + meta.json (deterministic; regenerate, never hand-edit).
// The reward database (passive points, refunds, bandits) is hand-checked in data/rewards.ts — not generated.
//
// Usage: node scripts/poe1-act-tracker-data.mjs [--cache <dir>] [--patch 3.30]
// Shares the download cache with scripts/poe1-campaign-data.mjs (same files, same User-Agent).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const PATCH = arg("--patch", "3.30");
const CACHE = arg("--cache", join(root, "node_modules", ".cache", "poe1-campaign"));
const OUT = join(root, "src", "games", "poe1", "act-tracker", "data", PATCH);
const UA = "Vaalytics (desktop companion; campaign data generator)";
const EL_REPO = "https://github.com/HeartofPhos/exile-leveling";
const EL_RAW = "https://raw.githubusercontent.com/HeartofPhos/exile-leveling/main/";
const REPOE = "https://repoe-fork.github.io/";

async function get(url, file) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(path, await res.text());
  }
  return readFileSync(path, "utf8");
}

const elCommit = JSON.parse(await get("https://api.github.com/repos/HeartofPhos/exile-leveling/commits?per_page=1", "el-commit.json"))[0];
const world = JSON.parse(await get(REPOE + "world_areas.min.json", "world_areas.min.json"));
const elAreas = JSON.parse(await get(EL_RAW + "common/data/json/areas.json", "el-areas.json"));
const elQuests = JSON.parse(await get(EL_RAW + "common/data/json/quests.json", "el-quests.json"));

const FLAGS = ["LEAGUE_START", "LIBRARY", "BANDIT_KILL", "BANDIT_ALIRA", "BANDIT_KRAITYN", "BANDIT_OAK"];
const DIRS = ["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"];
const errors = [];
/** Conditional blocks: which option they belong to and what they contain (trials, quest hand-ins). */
const blocks = {};
let pendingGroup = null;

const areaName = (id) => world[id]?.name ?? null;
const isTown = (id) => !!world[id]?.is_town;
const townOf = (id) => elAreas[id]?.parent_town_area_id ?? (isTown(id) ? id : null);
const checkArea = (id, where) => {
  if (!world[id]) errors.push(`${where}: unknown area id ${id}`);
  return id;
};
const questName = (id) => elQuests[id]?.name ?? null;

/** Renders route markup to plain text with real names. */
function render(text, where) {
  return text
    .replace(/\{([a-z_]+)(?:\|([^}]*))?\}/g, (_, kind, rest = "") => {
      const [a, b] = rest.split("|");
      switch (kind) {
        case "enter":
        case "area":
          checkArea(a, where);
          return areaName(a) ?? a;
        case "waypoint":
          if (a) checkArea(a, where);
          return a ? `Waypoint to ${areaName(a) ?? a}` : "the waypoint";
        case "waypoint_get":
          return "the waypoint";
        case "quest":
          if (!questName(a)) errors.push(`${where}: unknown quest ${a}`);
          return questName(a) ?? a;
        case "dir":
          return DIRS[Math.round(Number(a) / 45) % 8];
        case "logout":
          return "Log out (back to town)";
        case "portal":
          return a === "set" ? "a town portal" : "the town portal";
        case "trial":
          return "the Trial of Ascendancy";
        case "crafting":
          return "the crafting recipe";
        case "ascend":
          return `the ${a[0].toUpperCase()}${a.slice(1)} Labyrinth`;
        default: // kill, arena, generic, quest_text
          return b ?? a ?? kind;
      }
    })
    .replace(/(\d)x(?=\S)/g, "$1× ")
    .replace(/➞/g, "→")
    .replace(/\s+/g, " ")
    .trim();
}

const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);

const steps = [];
let current = "1_1_1"; // a new character starts on The Twilight Strand
let portalAt = null; // where the last town portal was opened
for (let act = 1; act <= 10; act++) {
  const lines = (await get(`${EL_RAW}common/data/routes/act-${act}.txt`, `el-act-${act}.txt`)).split(/\r?\n/);
  let cond = null; // { flag, negate }
  // Consecutive conditional blocks are alternatives (e.g. the four bandit branches): each starts where the
  // group started, and all must end in the same area, so the steps after the group have one position.
  let group = null; // { base, ends: [], flags: [] }
  let lastWasEndif = false;
  let blockNo = 0;
  let step = null;
  let n = 0;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const where = `act-${act}.txt:${i + 1}`;
    if (!line || line.startsWith("#section")) return;
    const ifm = line.match(/^#if(n?)def (\w+)/);
    if (ifm) {
      if (cond) errors.push(`${where}: nested conditional`);
      if (!FLAGS.includes(ifm[2])) errors.push(`${where}: unknown flag ${ifm[2]}`);
      cond = { flag: ifm[2], negate: ifm[1] === "n", block: `a${act}.b${++blockNo}` };
      blocks[cond.block] = { act, flag: cond.flag, negate: cond.negate, trial: false, quests: [] };
      if (lastWasEndif && group) current = group.base;
      else group = { base: current, ends: [], flags: [], where };
      group.flags.push(`${cond.negate ? "!" : ""}${cond.flag}`);
      lastWasEndif = false;
      return;
    }
    if (line.startsWith("#endif")) {
      cond = null;
      group.ends.push(current);
      lastWasEndif = true;
      return;
    }
    if (line.startsWith("#sub ") && lastWasEndif) errors.push(`${where}: hint right after a conditional block`);
    if (!line.startsWith("#") && lastWasEndif) {
      closeGroup(group);
      lastWasEndif = false;
    }
    if (line.startsWith("#sub ")) {
      if (!step) return;
      const text = line.slice(5);
      const dir = text.match(/\{dir\|(\d+)\}/);
      const lvl = text.match(/Recommended Level: ([\d-]+)/);
      if (lvl) step.recommendedLevel = lvl[1];
      else step.hints.push({ text: render(text, where), ...(dir ? { direction: Number(dir[1]) } : {}) });
      return;
    }
    if (line.startsWith("#")) return;
    const content = line.replace(/\s#[^{}]*$/, ""); // trailing comment (area/quest names)
    const enters = all(/\{enter\|([^}|]+)\}/g, content);
    const wp = content.match(/\{waypoint\|([^}|]+)\}/)?.[1] ?? null;
    const quests = [...content.matchAll(/\{quest\|([^}|]+)(?:\|([^}|]+))?\}/g)].map((m) => ({ id: m[1], offer: m[2] ?? m[1] }));
    const kind = enters.length
      ? "enter"
      : wp
        ? "waypoint"
        : /\{logout\}/.test(content)
          ? "logout"
          : /\{portal\|use\}/.test(content)
            ? "portal"
            : quests.length && /^Hand in/.test(content)
              ? "hand-in"
              : /\{trial\}/.test(content)
                ? "trial"
                : /\{ascend\|/.test(content)
                  ? "labyrinth"
                  : /\{kill\|/.test(content)
                    ? "kill"
                    : /\{waypoint_get\}/.test(content)
                      ? "get-waypoint"
                      : /\{crafting/.test(content)
                        ? "crafting"
                        : /\{quest_text\|/.test(content)
                          ? "quest-item"
                          : "other";
    resolvePending(kind);
    const at = current;
    step = {
      id: `a${act}.${String(++n).padStart(3, "0")}`,
      act,
      area: at,
      kind,
      text: render(content, where),
      ...(cond ? { when: cond } : {}),
      ...(enters.length ? { enters: enters.map((e) => checkArea(e, where)) } : {}),
      ...(wp ? { waypointTo: checkArea(wp, where) } : {}),
      ...(quests.length
        ? {
            quests: quests.map((q) => {
              if (!elQuests[q.id]) errors.push(`${where}: unknown quest ${q.id}`);
              const npc = elQuests[q.id]?.reward_offers?.[q.offer]?.quest_npc;
              return { id: q.id, name: questName(q.id) ?? q.id, ...(npc ? { npc } : {}) };
            }),
          }
        : {}),
      ...(all(/\{kill\|([^}]+)\}/g, content).length ? { kills: all(/\{kill\|([^}]+)\}/g, content) } : {}),
      ...(all(/\{quest_text\|([^}]+)\}/g, content).length ? { items: all(/\{quest_text\|([^}]+)\}/g, content) } : {}),
      ...(all(/\{arena\|([^}]+)\}/g, content).length ? { arena: all(/\{arena\|([^}]+)\}/g, content)[0] } : {}),
      ...(content.match(/\{ascend\|(\w+)\}/) ? { labyrinth: content.match(/\{ascend\|(\w+)\}/)[1] } : {}),
      ...(content.match(/\{portal\|(set|use)\}/) ? { portal: content.match(/\{portal\|(set|use)\}/)[1] } : {}),
      hints: [],
    };
    steps.push(step);
    if (cond) {
      const b = blocks[cond.block];
      if (kind === "trial") b.trial = true;
      for (const q of step.quests ?? []) if (kind === "hand-in") b.quests.push(q.id);
    }
    // Where the player is after this step (only the unconditional path and the taken branch move "current";
    // conditional branches start from the same place and, in the source route, end in the same place).
    let next = current;
    if (enters.length) next = enters[enters.length - 1];
    else if (wp) next = wp;
    else if (/\{portal\|set\}/.test(content)) portalAt = current;
    else if (/\{portal\|use\}/.test(content) && isTown(current) && portalAt) next = portalAt;
    else if (/\{logout\}/.test(content) || /\{portal\|use\}/.test(content)) next = townOf(current) ?? current;
    current = next;
  });
  if (lastWasEndif) closeGroup(group);
}

/** After a group of alternative blocks: every way through must end where the others end. A single optional
 *  block (no alternative) must end where it started, since skipping it leaves the player there. */
function closeGroup(g) {
  const ends = g.flags.length === 1 ? [g.base, ...g.ends] : g.ends;
  const set = new Set(ends);
  // Resolved by the next step: a waypoint makes every branch agree; a logout / portal must lead to one town.
  if (set.size > 1) pendingGroup = { g, ends: [...set] };
  current = g.ends[g.ends.length - 1];
}
function resolvePending(kind) {
  if (!pendingGroup) return;
  const { g, ends } = pendingGroup;
  pendingGroup = null;
  if (kind === "waypoint") return;
  if ((kind === "logout" || kind === "portal") && new Set(ends.map((e) => townOf(e))).size === 1) return;
  errors.push(`${g.where} [${g.flags.join(", ")}]: branches end in different areas (${ends.join(" / ")})`);
}

// Area lookups for the UI (names only for ids the route uses that are outside Acts 1–10, e.g. Karui Shores).
const extraAreas = {};
for (const s of steps)
  for (const id of [s.area, ...(s.enters ?? []), ...(s.waypointTo ? [s.waypointTo] : [])]) {
    const a = world[id];
    if (a && !(a.act >= 1 && a.act <= 10 && /^[12]_\d+_/.test(id))) extraAreas[id] = { name: a.name, act: a.act, town: !!a.is_town };
  }

// Labyrinth trips: the steps that only go to Aspirants' Plaza and run a Labyrinth (the waypoint back stays — it is a
// valid move from anywhere). A guide without trials skips them.
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  const toPlaza = s.enters?.includes("Labyrinth_Airlock") || s.waypointTo === "Labyrinth_Airlock";
  if (!toPlaza) continue;
  let start = i;
  const before = steps[i - 1];
  if (s.kind === "enter" && before?.kind === "waypoint" && isTown(before.waypointTo)) start = i - 1; // via the Act 3 town
  let end = i + 1;
  while (end < steps.length && !(steps[end].kind === "waypoint" && steps[end].area === "Labyrinth_Airlock")) end++;
  if (end >= steps.length) errors.push(`${s.id}: Labyrinth trip without a way back`);
  const lab = steps.slice(i, end).find((x) => x.labyrinth)?.labyrinth;
  if (!lab) errors.push(`${s.id}: trip to Aspirants' Plaza without a Labyrinth`);
  for (let k = start; k < end; k++) steps[k].labTrip = lab;
  i = end;
}

// Quests of Acts 1–10 with what they reward (quests.json reward offers: books are quest items, gems are per class).
const quests = {};
for (const [id, q] of Object.entries(elQuests)) {
  const act = Number(q.act);
  if (!q.name || act < 1 || act > 10) continue;
  const offers = Object.values(q.reward_offers ?? {});
  const items = offers.flatMap((o) => Object.keys(o.quest ?? {}));
  quests[id] = {
    name: q.name,
    act,
    npcs: [...new Set(offers.map((o) => o.quest_npc).filter(Boolean))].sort(),
    book: items.find((k) => /\/Book-/.test(k))?.replace(/^.*\//, "") ?? null,
    gemRewards: items.filter((k) => /\/Gems\//.test(k)).length,
    vendorGems: offers.reduce((n, o) => n + Object.keys(o.vendor ?? {}).length, 0),
    onRoute: steps.some((s) => s.kind === "hand-in" && s.quests?.some((x) => x.id === id)),
  };
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "route.json"), JSON.stringify({ steps, blocks, quests, extraAreas }, null, 1) + "\n");
const meta = {
  game: "poe1",
  patch: PATCH,
  counts: { steps: steps.length, acts: 10 },
  flags: FLAGS,
  source: {
    id: "exile-leveling",
    name: "exile-leveling (HeartofPhos) — levelling route",
    url: EL_REPO,
    author: "HeartofPhos and contributors",
    license: "MIT",
    version: elCommit?.sha?.slice(0, 12) ?? null,
    date: elCommit?.commit?.committer?.date?.slice(0, 10) ?? null,
    verification: "COMMUNITY_VERIFIED",
  },
};
writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(`wrote ${steps.length} steps → ${OUT}`);
