#!/usr/bin/env node
// Generates the Location Atlas (PoE 1) campaign dataset, Acts 1–10, from licensed sources:
//   - RePoE fork world_areas.json (extracted from the game files): areas, levels, towns, waypoints,
//     connections, boss count, layout topologies.
//   - exile-leveling (HeartofPhos, MIT): quest names and the route files' per-area navigation hints.
// Output: one JSON per act + meta.json in src/games/poe1/location-atlas/data/<patch>/ (deterministic).
//
// Usage: node scripts/poe1-campaign-data.mjs [--cache <dir>] [--patch 3.30]
// Downloads are cached; delete the cache to refresh. Respectful: a handful of static files, with a User-Agent.
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
const OUT = join(root, "src", "games", "poe1", "location-atlas", "data", PATCH);
const UA = "Vaalytics (desktop companion; campaign data generator)";

const REPOE = "https://repoe-fork.github.io/";
const EL_REPO = "https://github.com/HeartofPhos/exile-leveling";
const EL_RAW = "https://raw.githubusercontent.com/HeartofPhos/exile-leveling/main/";

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

const CAMPAIGN_ID = /^[12]_\d+_/;
const DIRS = ["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"];

const repoeVersion = (await get("https://api.github.com/repos/repoe-fork/repoe-fork.github.io/commits?per_page=1", "repoe-commit.json"))
  .match(/"message":"[^"]*?Version ([0-9.]+)/)?.[1];
const elCommit = JSON.parse(await get("https://api.github.com/repos/HeartofPhos/exile-leveling/commits?per_page=1", "el-commit.json"))[0];
const world = JSON.parse(await get(REPOE + "world_areas.min.json", "world_areas.min.json"));
const elAreas = JSON.parse(await get(EL_RAW + "common/data/json/areas.json", "el-areas.json"));
const elQuests = JSON.parse(await get(EL_RAW + "common/data/json/quests.json", "el-quests.json"));

// ---------- areas ----------
const areas = new Map();
for (const [id, a] of Object.entries(world)) {
  if (!CAMPAIGN_ID.test(id) || a.act < 1 || a.act > 10) continue;
  areas.set(id, a);
}
const kindOf = (id, a) => (a.is_town ? "town" : "area");
const out = {};
for (const [id, a] of [...areas].sort(([x], [y]) => x.localeCompare(y, "en", { numeric: true }))) {
  const el = elAreas[id];
  (out[a.act] ??= { act: a.act, areas: [], hints: [] }).areas.push({
    id,
    name: a.name,
    act: a.act,
    level: a.area_level,
    kind: kindOf(id, a),
    waypoint: !!a.has_waypoint,
    town: el?.parent_town_area_id ?? null,
    connections: a.connections.filter((c) => areas.has(c)).sort(),
    /** Connections to non-campaign content (Labyrinth, Sanctum, …), kept for completeness. */
    otherConnections: a.connections.filter((c) => !areas.has(c)).sort(),
    bossCount: a.bosses.length,
    actBossArea: a.tags.includes("act_boss_area"),
    /** The game's layout graph ids for this area (several = layouts vary). */
    topologies: a.topologies.map((t) => t.id).sort(),
    craftingRecipes: el?.crafting_recipes ?? [],
  });
}

// ---------- quests ----------
const quests = Object.values(elQuests)
  .filter((q) => q.name && Number(q.act) >= 1 && Number(q.act) <= 10)
  .map((q) => ({ id: q.id, name: q.name, act: Number(q.act), npcs: [...new Set(Object.values(q.reward_offers).map((o) => o.quest_npc).filter(Boolean))] }))
  .sort((a, b) => a.act - b.act || a.id.localeCompare(b.id, "en", { numeric: true }));
const questName = new Map(quests.map((q) => [q.id, q.name]));

// ---------- navigation hints from the route files ----------
const name = (id) => areas.get(id)?.name ?? id;
function render(text) {
  return text
    .replace(/\{([a-z_]+)(?:\|([^}]*))?\}/g, (_, kind, rest = "") => {
      const [a, b] = rest.split("|");
      switch (kind) {
        case "enter":
        case "area":
          return name(a);
        case "waypoint":
          return a ? `the waypoint to ${name(a)}` : "the waypoint";
        case "waypoint_get":
          return "the waypoint";
        case "quest":
          return questName.get(a) ?? a;
        case "dir":
          return DIRS[Math.floor(Number(a) / 45) % 8];
        case "logout":
          return "log out";
        case "portal":
          return a === "set" ? "open a town portal" : "take the town portal";
        case "trial":
          return "the Labyrinth trial";
        case "crafting":
          return "the crafting recipe";
        case "ascend":
          return "the Labyrinth";
        default:
          return b ?? a ?? kind;
      }
    })
    .replace(/(\d)x(?=\S)/g, "$1× ")
    .replace(/➞/g, "→")
    .replace(/\s+/g, " ")
    .trim();
}
let hintCount = 0;
const bossesByArea = new Map();
for (let act = 1; act <= 10; act++) {
  const lines = (await get(`${EL_RAW}common/data/routes/act-${act}.txt`, `el-act-${act}.txt`)).split(/\r?\n/);
  let current = act === 1 ? "1_1_1" : null;
  let townOf = null;
  let step = null; // { raw, area, to }
  let leagueStart = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#ifdef LEAGUE_START")) leagueStart = true;
    else if (line.startsWith("#ifndef") || line.startsWith("#endif")) leagueStart = false;
    if (line.startsWith("#sub ")) {
      if (!step || !step.area || !areas.has(step.area)) continue; // e.g. the endgame town after Act 10
      const text = line.slice(5);
      const dir = text.match(/\{dir\|(\d+)\}/);
      const level = text.match(/Recommended Level: (\d+)/);
      out[act].hints.push({
        area: step.area,
        ...(step.to ? { toward: step.to } : {}),
        step: render(step.raw),
        text: render(text),
        ...(dir ? { direction: Number(dir[1]) } : {}),
        ...(level ? { recommendedLevel: Number(level[1]) } : {}),
        leagueStartOnly: leagueStart,
      });
      hintCount++;
      continue;
    }
    if (line.startsWith("#")) continue;
    const content = line.replace(/\s#[^{}]*$/, ""); // trailing comment (area/quest names)
    const enter = [...content.matchAll(/\{enter\|([^}|]+)\}/g)].map((m) => m[1]);
    const wp = content.match(/\{waypoint\|([^}|]+)\}/)?.[1];
    for (const k of content.matchAll(/\{kill\|([^}]+)\}/g)) {
      if (current) bossesByArea.set(current, [...new Set([...(bossesByArea.get(current) ?? []), k[1]])]);
    }
    step = { raw: content, area: current, to: enter[0] ?? null };
    if (enter.length) current = enter[enter.length - 1];
    else if (wp) current = wp;
    else if (/\{logout\}/.test(content) || /\{portal\|use\}/.test(content)) current = elAreas[current]?.parent_town_area_id ?? current;
    if (current && areas.get(current)?.is_town) townOf = current;
  }
  void townOf;
}
for (const a of Object.values(out).flatMap((x) => x.areas)) {
  const b = bossesByArea.get(a.id);
  if (b) a.bossNames = b;
}

// ---------- write ----------
mkdirSync(OUT, { recursive: true });
for (const act of Object.values(out)) {
  act.quests = quests.filter((q) => q.act === act.act);
  writeFileSync(join(OUT, `act-${String(act.act).padStart(2, "0")}.json`), JSON.stringify(act, null, 2) + "\n");
}
const meta = {
  game: "poe1",
  patch: PATCH,
  acts: Object.keys(out).map(Number).sort((a, b) => a - b),
  counts: { areas: areas.size, hints: hintCount, quests: quests.length },
  sources: [
    {
      id: "repoe",
      name: "RePoE fork — world_areas.json",
      url: REPOE + "world_areas.json",
      author: "RePoE fork contributors (data extracted from the game files)",
      license: "Game data (Grinding Gear Games); export used as reference data, as for crafting",
      type: "game-data",
      version: repoeVersion ?? null,
      provides: ["areas", "levels", "towns", "waypoints", "connections", "boss count", "layout topologies"],
      verification: "verified",
    },
    {
      id: "exile-leveling",
      name: "exile-leveling (HeartofPhos)",
      url: EL_REPO,
      author: "HeartofPhos and contributors",
      license: "MIT",
      type: "community",
      version: elCommit?.sha?.slice(0, 12) ?? null,
      provides: ["quest names", "boss names per area", "navigation hints", "crafting recipes"],
      verification: "community",
    },
  ],
};
writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(`wrote ${meta.acts.length} acts, ${areas.size} areas, ${hintCount} hints, ${quests.length} quests → ${OUT}`);
