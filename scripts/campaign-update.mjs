#!/usr/bin/env node
// /campaign-update — checks the PoE 1 campaign data (Location Atlas + Act Tracker) against its sources.
//
//   node scripts/campaign-update.mjs [--dry-run] [--restore <backup dir>]
//
// 1. Backs up the current generated data (Atlas acts + meta, Act Tracker route + meta).
// 2. Downloads the sources again into a FRESH cache (RePoE world_areas, exile-leveling routes/quests/areas) and runs
//    both generators (scripts/poe1-campaign-data.mjs, scripts/poe1-act-tracker-data.mjs).
// 3. Compares old vs new: source versions, areas (level, connections, waypoint), route steps, quests and their book
//    rewards. Book changes are flagged for MANUAL review of src/games/poe1/act-tracker/data/rewards.ts — that file is
//    hand-checked (VERIFIED from the game's /passives output) and is never changed by this script.
// 4. Runs the dataset validators and tests (vitest: act-tracker + location-atlas).
// 5. Writes a report to docs/reports/campaign-update-<date>.md.
// --dry-run restores the old data afterwards (report only). --restore puts a backup back (undo an update).
// Respectful: a handful of static files with a User-Agent, same as the generators.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => process.argv.includes(n);
const val = (n) => (process.argv.indexOf(n) > 0 ? process.argv[process.argv.indexOf(n) + 1] : null);
const PATCH = "3.30";
const DATA = {
  atlas: join(root, "src", "games", "poe1", "location-atlas", "data", PATCH),
  tracker: join(root, "src", "games", "poe1", "act-tracker", "data", PATCH),
};
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const cacheRoot = join(root, "node_modules", ".cache");

function backup() {
  const dir = join(cacheRoot, `campaign-update-backup-${stamp}`);
  for (const [k, d] of Object.entries(DATA)) cpSync(d, join(dir, k), { recursive: true });
  return dir;
}
function restore(dir) {
  for (const [k, d] of Object.entries(DATA)) {
    if (!existsSync(join(dir, k))) throw new Error(`backup ${dir} has no ${k}`);
    rmSync(d, { recursive: true, force: true });
    cpSync(join(dir, k), d, { recursive: true });
  }
}

if (val("--restore")) {
  restore(val("--restore"));
  console.log(`restored the campaign data from ${val("--restore")}`);
  process.exit(0);
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
function snapshot() {
  const acts = readdirSync(DATA.atlas).filter((f) => /^act-\d+\.json$/.test(f)).flatMap((f) => readJson(join(DATA.atlas, f)).areas);
  const route = readJson(join(DATA.tracker, "route.json"));
  return {
    atlasMeta: readJson(join(DATA.atlas, "meta.json")),
    trackerMeta: readJson(join(DATA.tracker, "meta.json")),
    areas: new Map(acts.map((a) => [a.id, a])),
    steps: new Map(route.steps.map((s) => [s.id, s])),
    quests: route.quests,
  };
}

const before = snapshot();
const backupDir = backup();
const cache = join(cacheRoot, `poe1-campaign-update-${stamp}`);
let generated = true;
const log = [];
try {
  for (const g of ["poe1-campaign-data.mjs", "poe1-act-tracker-data.mjs"])
    log.push(execFileSync(process.execPath, [join(root, "scripts", g), "--cache", cache, "--patch", PATCH], { cwd: root, encoding: "utf8" }).trim());
} catch (e) {
  generated = false;
  log.push(String(e.stdout ?? "") + String(e.stderr ?? e.message));
}
const after = generated ? snapshot() : before;

// ---------- diff
const lines = [];
const versions = (m) => Object.fromEntries((m.sources ?? [m.source]).map((s) => [s.id, s.version]));
const v0 = { ...versions(before.atlasMeta), route: before.trackerMeta.source.version };
const v1 = { ...versions(after.atlasMeta), route: after.trackerMeta.source.version };
for (const k of new Set([...Object.keys(v0), ...Object.keys(v1)])) lines.push(`- ${k}: ${v0[k] ?? "—"} → ${v1[k] ?? "—"}${v0[k] === v1[k] ? " (same)" : ""}`);

const areaChanges = [];
for (const [id, a] of after.areas) {
  const o = before.areas.get(id);
  if (!o) areaChanges.push(`added ${id} ${a.name}`);
  else {
    const d = [];
    if (o.level !== a.level) d.push(`level ${o.level}→${a.level}`);
    if (o.waypoint !== a.waypoint) d.push(`waypoint ${o.waypoint}→${a.waypoint}`);
    if (JSON.stringify(o.connections) !== JSON.stringify(a.connections)) d.push("connections");
    if (o.name !== a.name) d.push(`name "${o.name}"→"${a.name}"`);
    if (d.length) areaChanges.push(`${id} ${a.name}: ${d.join(", ")}`);
  }
}
for (const [id, o] of before.areas) if (!after.areas.has(id)) areaChanges.push(`REMOVED ${id} ${o.name}`);

const stepChanges = { added: 0, removed: 0, changed: 0 };
for (const [id, s] of after.steps) {
  const o = before.steps.get(id);
  if (!o) stepChanges.added++;
  else if (o.text !== s.text || o.area !== s.area || JSON.stringify(o.enters) !== JSON.stringify(s.enters)) stepChanges.changed++;
}
for (const id of before.steps.keys()) if (!after.steps.has(id)) stepChanges.removed++;

const questChanges = [];
const bookChanges = [];
for (const [id, q] of Object.entries(after.quests)) {
  const o = before.quests[id];
  if (!o) questChanges.push(`added ${id} ${q.name}`);
  else if (o.name !== q.name) questChanges.push(`${id} renamed "${o.name}"→"${q.name}"`);
  if ((o?.book ?? null) !== q.book) bookChanges.push(`${id} ${q.name}: book ${o?.book ?? "none"} → ${q.book ?? "none"}`);
}
for (const [id, o] of Object.entries(before.quests)) if (!after.quests[id]) questChanges.push(`REMOVED ${id} ${o.name}${o.book ? ` (had ${o.book})` : ""}`);

// ---------- validators and tests
let tests = "not run (generation failed)";
let testsOk = false;
if (generated) {
  try {
    const out = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "src/games/poe1/act-tracker", "src/games/poe1/location-atlas"], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    tests = (out.match(/Tests\s+.*$/m)?.[0] ?? "passed").trim();
    testsOk = true;
  } catch (e) {
    tests = `FAILED — ${(String(e.stdout ?? "").match(/Tests\s+.*$/m)?.[0] ?? e.message).trim()}`;
  }
}

if (arg("--dry-run")) restore(backupDir);

// ---------- report
const date = new Date().toISOString().slice(0, 10);
const reportDir = join(root, "docs", "reports");
mkdirSync(reportDir, { recursive: true });
const report = `# Campaign data update — ${date}${arg("--dry-run") ? " (dry run)" : ""}

Sources re-downloaded into a fresh cache (\`${cache.replace(root, ".")}\`).
${generated ? "" : "\n**Generation failed** — nothing was changed:\n\n```\n" + log.join("\n") + "\n```\n"}
## Source versions

${lines.join("\n")}

## Areas (game files)

${areaChanges.length ? areaChanges.map((c) => `- ${c}`).join("\n") : "No changes."}

## Levelling route (exile-leveling)

Steps: ${after.steps.size} (${stepChanges.added} added, ${stepChanges.removed} removed, ${stepChanges.changed} changed).
${stepChanges.removed || stepChanges.changed ? "Marks of removed or renumbered steps no longer match; guide profiles report such edits as stale." : ""}

## Quests

${questChanges.length ? questChanges.map((c) => `- ${c}`).join("\n") : "No changes."}

## Book rewards — MANUAL REVIEW

${
  bookChanges.length
    ? bookChanges.map((c) => `- ${c}`).join("\n") +
      "\n\nThe reward database (`src/games/poe1/act-tracker/data/rewards.ts`) was NOT changed. Check the change in game (`/passives`) or a second source before editing it."
    : "No book changes: the passive point and respec quests are the same as in the verified reward database."
}

## Validators and tests

${tests}${testsOk ? "" : "\n\nDo not ship this data: fix the generator / data or restore the backup."}

## Undo

${arg("--dry-run") ? "Dry run: the previous data was restored automatically." : "The previous data is in the backup below; to put it back:"}

\`\`\`
node scripts/campaign-update.mjs --restore "${backupDir}"
\`\`\`
`;
const reportPath = join(reportDir, `campaign-update-${date}.md`);
writeFileSync(reportPath, report);
console.log(`report: ${reportPath}\nbackup: ${backupDir}\ntests: ${tests}`);
process.exit(generated && testsOk ? 0 : 1);
