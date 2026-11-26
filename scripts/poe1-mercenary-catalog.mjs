#!/usr/bin/env node
// Generates the Mercenary Intelligence catalog (PoE 1) from public sources:
//   - PoEDB "Mercenaries" overview and one page per build (game-file data, CC BY-NC-SA 3.0):
//     house (tribe), class attributes, weapons, Primary / Secondary / Utility skill pools,
//     support count class per skill and every support (with tier) a skill can roll.
//   - Official Trade data (pathofexile.com/api/trade/data/stats and /items): the real stat id of
//     every mercenary skill and support tier, and the warrant type id of every build.
// Nothing is invented: a skill or support that can't be matched to an official stat id is
// reported and kept with `stat: null` so the module can show it as unverified.
//
// Output: src/games/poe1/mercenary/data/catalog-<patch>.json (deterministic, sorted).
// Usage: node scripts/poe1-mercenary-catalog.mjs [--cache <dir>] [--patch 3.30.0] [--league Covens] [--revision 1]
// Downloads are cached (delete the cache to refresh). PoEDB pages are fetched one at a time,
// 1.5 s apart, with a User-Agent; robots.txt allows these pages.
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const PATCH = arg("--patch", "3.30.0");
const LEAGUE = arg("--league", "Covens");
const REVISION = Number(arg("--revision", "1"));
const CACHE = arg("--cache", join(root, "node_modules", ".cache", "poe1-mercenary"));
const OUT = join(root, "src", "games", "poe1", "mercenary", "data", `catalog-${PATCH.split(".").slice(0, 2).join(".")}.json`);
const UA = "Vaalytics (desktop companion; mercenary catalog generator)";
const POEDB = "https://poedb.tw/us/";
const TRADE = "https://www.pathofexile.com/api/trade/data/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetched = {};
async function get(url, file, delay = 0) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    if (delay) await sleep(delay);
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const body = await res.text();
    if (body.length > 8 * 1024 * 1024) throw new Error(`${url}: response too large`);
    writeFileSync(path, body);
  }
  fetched[url] = statSync(path).mtime.toISOString();
  return readFileSync(path, "utf8");
}

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
export const slug = (s) =>
  s
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
const ROMAN = { I: 1, II: 2, III: 3 };

/** Support identity: tier prefixes dropped; "Greater Area of Effect" is the T3 of "Increased Area of Effect". */
export const SUPPORT_ALIASES = { "Area of Effect": "Increased Area of Effect" };
export function supportIdentity(name) {
  const base = name.replace(/^(Greater|Lesser) /, "");
  return SUPPORT_ALIASES[base] ?? base;
}

// ---------- PoEDB ----------

function parseOverview(html) {
  const cards = html.split('<div class="col"><div class="d-flex border-top rounded">').slice(1);
  const out = [];
  for (const c of cards) {
    const m = c.match(/<strong><a href="([^"]+)">([^<]+)<\/a><\/strong>\s*<small>([^<]*)<\/small>/);
    if (!m) continue;
    out.push({ href: m[1], name: decode(m[2]) });
  }
  return out;
}

function parseBuild(html, href) {
  const header = html.match(/<h5 class="card-header">[\s\S]*?<\/h5>\s*<div class="card-body">([\s\S]*?)<div class="border">/);
  if (!header) throw new Error(`${href}: build header not found`);
  const body = header[1];
  const cls = body.match(/Class:\s*([^<(]+?)\s*\((\w+)\)/);
  const weapons = [...(body.match(/Weapon:([\s\S]*?)<\/div>/)?.[1] ?? "").matchAll(/>([^<]+)<\/a>/g)].map((x) => decode(x[1]));
  const tribe = body.match(/Tribe:\s*([^<]+)/)?.[1]?.trim() ?? null;
  const name = decode(html.match(/<h5 class="card-header">[\s\S]*?<a href="[^"]+">([^<]+)<\/a><\/h5>/)?.[1] ?? href);

  const skills = [];
  const sections = html.split(/<h4>(Primary|Secondary|Utility)<\/h4>/);
  for (let i = 1; i < sections.length; i += 2) {
    const category = sections[i].toLowerCase();
    let part = sections[i + 1];
    const end = part.search(/<h4>|<h5|id="footer"|class="footer/);
    if (end > 0) part = part.slice(0, end);
    const popups = part.split('<div class="newItemPopup GemPopup').slice(1);
    for (const p of popups) {
      const skillName = decode(p.match(/<span class="lc">([^<]+)<\/span>/)?.[1] ?? "");
      if (!skillName) continue;
      const prop = (label) => {
        const m = p.match(new RegExp(`${label}:\\s*<span class='colourDefault'>([\\s\\S]*?)</span></div>`));
        return m ? decode(m[1].replace(/<[^>]+>/g, " ")) : null;
      };
      const level = prop("Level")?.match(/\((\d+)\s*—\s*(\d+)\)/);
      const requires = [...(p.match(/<div class="requirements">([\s\S]*?)<\/div>/)?.[1] ?? "").matchAll(/>([^<]+)<\/a>/g)].map((x) => decode(x[1]));
      const supports = [];
      for (const s of p.matchAll(/<div class="flex-grow-1 ms-2">([^<]+?)\s*<span>(I{1,3})<\/span>/g)) {
        const display = decode(s[1]);
        supports.push({ display, tier: ROMAN[s[2]], identity: supportIdentity(display) });
      }
      skills.push({
        category,
        name: skillName,
        supportCount: prop("Support Counts"),
        levelRange: level ? [Number(level[1]), Number(level[2])] : null,
        requires,
        supports,
      });
    }
  }
  return {
    name,
    attributes: cls ? cls[1].split("/").map((s) => s.trim()) : [],
    classTag: cls ? cls[2] : null,
    weapons,
    tribe,
    skills,
  };
}

// ---------- main ----------

const overview = parseOverview(await get(`${POEDB}Mercenaries`, "poedb-mercenaries.html"));
console.log(`PoEDB overview: ${overview.length} builds`);
const builds = [];
for (const b of overview) {
  const html = await get(`${POEDB}${b.href}`, `poedb-${b.href}.html`, 1500);
  const parsed = parseBuild(html, b.href);
  builds.push({ ...parsed, poedb: b.href, overviewName: b.name });
}

const statsJson = JSON.parse(await get(`${TRADE}stats`, "trade-stats.json"));
const itemsJson = JSON.parse(await get(`${TRADE}items`, "trade-items.json"));
const mercStats = statsJson.result.flatMap((g) => g.entries).filter((e) => e.id.startsWith("mercenary."));
const skillStats = new Map();
const supportStats = new Map();
for (const e of mercStats) {
  if (e.id.startsWith("mercenary.skill_")) {
    skillStats.set(e.text, [...(skillStats.get(e.text) ?? []), e.id]);
  } else {
    const m = e.text.match(/^(.*) \(Tier (\d)\)$/);
    if (!m) throw new Error(`unexpected support stat ${e.text}`);
    const key = `${m[1]}|${m[2]}`;
    supportStats.set(key, [...(supportStats.get(key) ?? []), e.id]);
  }
}
const warrantTypes = itemsJson.result
  .flatMap((g) => g.entries)
  .filter((e) => e.disc === "mercenary_warrant")
  .map((e) => ({ type: e.type, label: e.text.replace(/^Mercenary Warrant \((.*)\)$/, "$1") }));

// Same text, different stat per owning skill. Verified live with real searches (see
// docs/mercenary-intelligence/CATALOG_AUDIT.md); everything else must be unambiguous.
// Herald of Ash on Chaplain of the Well: 31201 matches 8,245 Chaplain warrants, 44334 matches 0 (2026-11-26).
const SKILL_STAT_BY_BUILD = { "Herald of Ash": { chaplain_of_the_well: "mercenary.skill_31201", eruptor: "mercenary.skill_44334", flaming_charlatan: "mercenary.skill_44334" } };
// Verified 2026-11-26 (Covens, securable): 37259 matches 1,371 Warpriest and 5,529 / 1,493 Chaplain
// (Smite / Vaal Smite) warrants and 0 Thunderquiver; 58471 matches 1,586 Thunderquiver and 0 of the others.
const SUPPORT_STAT_BY_SKILL = {
  "Gilded Extra Targets|3": {
    smite: "mercenary.support_37259",
    vaal_smite: "mercenary.support_37259",
    lightning_arrow: "mercenary.support_58471",
    greater_lightning_arrow: "mercenary.support_58471",
  },
};

const problems = [];
const skills = new Map();
const supports = new Map();
const families = new Map();

for (const b of builds) {
  if (!b.skills.length) {
    problems.push(`build ${b.name} (${b.poedb}) has no skills on PoEDB — skipped (not a real warrant build)`);
    continue;
  }
  const infamous = b.name.startsWith("Infamous ");
  const familyName = infamous ? b.name.slice("Infamous ".length) : b.name;
  const familyId = slug(familyName);
  const wt = warrantTypes.find((w) => w.label === b.name);
  if (!wt) {
    problems.push(`build ${b.name} (${b.poedb}) has no official warrant type — skipped (not a tradable warrant)`);
    continue;
  }
  const fam = families.get(familyId) ?? {
    id: familyId,
    name: familyName,
    house: b.tribe,
    attributes: b.attributes,
    classTag: b.classTag,
    weapons: b.weapons,
    variants: [],
  };
  const pools = { primary: [], secondary: [], utility: [] };
  const variantSkills = {};
  for (const s of b.skills) {
    const id = slug(s.name);
    pools[s.category].push(id);
    let stat = null;
    const ids = skillStats.get(s.name) ?? [];
    if (ids.length === 1) stat = ids[0];
    else if (SKILL_STAT_BY_BUILD[s.name]?.[familyId]) stat = SKILL_STAT_BY_BUILD[s.name][familyId];
    else if (ids.length > 1) problems.push(`skill ${s.name}: ${ids.length} stats, no disambiguation`);
    else if (s.name !== "[DNT] Unused") problems.push(`skill ${s.name} (${b.name}): no official trade stat`);
    if (s.name === "[DNT] Unused") continue;
    const sk = skills.get(id) ?? {
      id,
      name: s.name,
      trarthus: / of Trarthus$/.test(s.name) || s.name.startsWith("Trarthan "),
      vaal: s.name.startsWith("Vaal "),
      stats: [],
    };
    if (stat && !sk.stats.includes(stat)) sk.stats.push(stat);
    skills.set(id, sk);
    const sup = [];
    for (const x of s.supports) {
      const sid = slug(x.identity);
      const key = `${x.display}|${x.tier}`;
      let sstat = null;
      const sids = supportStats.get(key) ?? [];
      if (sids.length === 1) sstat = sids[0];
      else if (SUPPORT_STAT_BY_SKILL[key]?.[id]) sstat = SUPPORT_STAT_BY_SKILL[key][id];
      else problems.push(`support ${x.display} T${x.tier} on ${s.name}: ${sids.length} official stats`);
      const so = supports.get(sid) ?? { id: sid, name: x.identity, tiers: {} };
      const t = so.tiers[x.tier] ?? { display: x.display, stats: [] };
      if (t.display !== x.display) problems.push(`support ${sid} T${x.tier}: two display names (${t.display} / ${x.display})`);
      if (sstat && !t.stats.includes(sstat)) t.stats.push(sstat);
      so.tiers[x.tier] = t;
      supports.set(sid, so);
      const prev = sup.find((e) => e.support === sid);
      // PoEDB sometimes lists the same support tier twice for one skill; a tier counts once.
      if (prev && prev.tiers.includes(x.tier)) continue;
      if (prev) prev.tiers.push(x.tier);
      else sup.push({ support: sid, tiers: [x.tier], stat: {} });
      const entry = sup.find((e) => e.support === sid);
      // Only a stat that differs from the support table's single id is written per skill.
      if (sstat && sids.length !== 1) entry.stat[x.tier] = sstat;
    }
    variantSkills[id] = {
      category: s.category,
      // Only when the skill's text has more than one official stat (Herald of Ash).
      ...(ids.length > 1 && stat ? { stat } : {}),
      supportCount: s.supportCount,
      levelRange: s.levelRange,
      requires: s.requires,
      // "support:tiers" (e.g. "return:3", "chain:12"), "@stat" appended when the stat depends on this skill.
      supports: sup.map((e) => `${e.support}:${e.tiers.sort().join("")}${Object.entries(e.stat).map(([t, st]) => `@${t}=${st}`).join("")}`),
    };
  }
  fam.variants.push({ id: infamous ? `${familyId}.infamous` : familyId, name: b.name, infamous, warrantType: wt?.type ?? null, poedb: b.poedb, pools, skills: variantSkills });
  families.set(familyId, fam);
}

for (const w of warrantTypes) {
  if (![...families.values()].some((f) => f.variants.some((v) => v.warrantType === w.type))) problems.push(`warrant type ${w.type} (${w.label}) has no PoEDB build`);
}
const usedSkillStats = new Set([...skills.values()].flatMap((s) => s.stats));
for (const [text, ids] of skillStats) for (const id of ids) if (!usedSkillStats.has(id)) problems.push(`official skill stat ${id} (${text}) is on no PoEDB build`);
const usedSupportStats = new Set([...supports.values()].flatMap((s) => Object.values(s.tiers).flatMap((t) => t.stats)));
for (const [key, ids] of supportStats) for (const id of ids) if (!usedSupportStats.has(id)) problems.push(`official support stat ${id} (${key.replace("|", " T")}) is on no PoEDB build`);

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const catalog = {
  meta: {
    schema: 1,
    catalogVersion: `${PATCH}-r${REVISION}`,
    gameVersion: PATCH,
    league: LEAGUE,
    platform: "pc",
    generatedAt: new Date().toISOString().slice(0, 10),
    sources: Object.entries(fetched)
      .filter(([u]) => !u.includes("poedb.tw/us/") || u.endsWith("/Mercenaries"))
      .map(([url, at]) => ({ url, fetchedAt: at.slice(0, 10) }))
      .concat([{ url: `${POEDB}<build> (${builds.length} build pages)`, fetchedAt: new Date().toISOString().slice(0, 10) }]),
    licence: "Game data from PoEDB (CC BY-NC-SA 3.0) and the official Trade API; facts only, attributed in docs/mercenary-intelligence/SOURCES.md.",
    counts: {
      families: families.size,
      variants: [...families.values()].reduce((n, f) => n + f.variants.length, 0),
      skills: skills.size,
      supportIdentities: supports.size,
      officialSkillStats: [...skillStats.values()].flat().length,
      officialSupportStats: [...supportStats.values()].flat().length,
      warrantTypes: warrantTypes.length,
    },
    problems,
  },
  families: [...families.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => {
      const variants = f.variants.sort((a, b) => Number(a.infamous) - Number(b.infamous)).map((v) => ({ ...v, skills: sortObj(v.skills) }));
      // Variants keep their own pools and warrant type. Skill rules are written once when every
      // variant has exactly the same rules (checked here, not assumed); otherwise per variant.
      const same = variants.every((v) => JSON.stringify(v.skills) === JSON.stringify(variants[0].skills));
      if (!same) problems.push(`family ${f.id}: variants differ in skill rules — kept per variant`);
      return same
        ? { ...f, skills: variants[0].skills, variants: variants.map(({ skills: _s, ...v }) => v) }
        : { ...f, skills: null, variants };
    }),
  skills: [...skills.values()].sort((a, b) => a.id.localeCompare(b.id)),
  supports: [...supports.values()].sort((a, b) => a.id.localeCompare(b.id)).map((s) => ({ ...s, tiers: sortObj(s.tiers) })),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(catalog, null, 1) + "\n");
console.log(JSON.stringify(catalog.meta.counts));
console.log(`${problems.length} problems:\n  ${problems.join("\n  ")}`);
console.log(`wrote ${OUT}`);
