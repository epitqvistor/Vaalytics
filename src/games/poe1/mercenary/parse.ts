/**
 * Mercenary Warrant parser (Ctrl+C text from the English client, and official Trade listings).
 *
 * Real 3.30 layout (decoded from Trade `extended.text`, 2026-11-26):
 *   Item Class: Map Fragments / Rarity: Normal / Mercenary Warrant
 *   -------- <mercenary name>
 *   -------- Build: [Infamous ]<build> / Mercenary Level: 83
 *   -------- one section per skill: skill name, then "Support (Tier: N)" lines bound to it
 *   -------- usage text -------- Note: …
 * PoEDB also shows "Limit: 1", "Portal: The Proving Grounds", "Area Level: 83" on 3.30 warrants;
 * those (and "Item Tier", "Item Level") are recognised and never read as the mercenary level.
 *
 * Supports always stay attached to the skill section they appear in. Every field carries a
 * status; nothing is guessed silently. The raw text is not stored.
 */
import { catalogIndex, type CatalogFamily, type CatalogIndex, type CatalogVariant } from "./catalog";
import type { MercListing } from "@/core/ipc/commands";
import type { Field, ParsedSkill, ParsedSupport, ParsedWarrant, WarrantCorrections } from "./types";

const MAX_TEXT = 64 * 1024;
const SEPARATOR = /^\s*-{4,}\s*$/;
const SUPPORT_LINE = /^(.+?)\s*\((?:Tier:?\s*)?([123]|I{1,3})\)\s*$/i;
const META_LINE = /^(Item Class|Rarity|Item Level|Item Tier|Area Level|Limit|Portal|Note|Stack Size|Requires)\b\s*:/i;
const FLAG_LINE = /^(Corrupted|Unidentified|Mirrored|Split)$/i;
const DESCRIPTION = /^(Right click this item|Open a portal|This previously fought|While viewing your Atlas|Place into a|Can be used in)/i;
const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3 };

const field = <T>(value: T | null, status: Field<T>["status"], note?: string, options?: T[]): Field<T> => ({
  value,
  status,
  ...(note ? { note } : {}),
  ...(options ? { options } : {}),
});

export function looksLikeWarrant(text: string): boolean {
  if (!text || text.length > MAX_TEXT) return false;
  const t = text.toLowerCase();
  return t.includes("mercenary warrant") || (/^build:/m.test(t) && /^mercenary level:/m.test(t));
}

function sections(text: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (SEPARATOR.test(line)) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    const t = line.trim();
    if (t) cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Joins a name that wrapped onto the next line (OCR / narrow copies) when only the joined text is known. */
function unwrapSkillName(lines: string[], idx: CatalogIndex): { name: string; used: number } {
  const [first = "", second] = lines;
  if (idx.skill(first) || second === undefined || SUPPORT_LINE.test(first)) return { name: first, used: 1 };
  const joined = `${first} ${second}`;
  if (!SUPPORT_LINE.test(second) && idx.skill(joined)) return { name: joined, used: 2 };
  return { name: first, used: 1 };
}

function unwrapSupports(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? "";
    const next = lines[i + 1];
    if (!SUPPORT_LINE.test(l) && next !== undefined && SUPPORT_LINE.test(next) && /^[A-Z]/.test(l)) {
      out.push(`${l} ${next}`);
      i++;
    } else out.push(l);
  }
  return out;
}

interface Ctx {
  idx: CatalogIndex;
  family: CatalogFamily | null;
  variant: CatalogVariant | null;
}

function resolveSkill(name: string, ctx: Ctx): Pick<ParsedSkill, "skill" | "category" | "stat"> {
  const s = ctx.idx.skill(name);
  if (!s) return { skill: field<string>(null, "unknown", "Not a mercenary skill in the 3.30 catalog."), category: null, stat: null };
  if (!ctx.family) return { skill: field(s.id, "inferred", "Family unknown, so the skill pool can't be checked."), category: null, stat: s.stats.length === 1 ? (s.stats[0] ?? null) : null };
  const rule = ctx.idx.skillRule(ctx.family, ctx.variant, s.id);
  if (!rule) {
    return {
      skill: field(s.id, "ambiguous", `${s.name} is not in the ${ctx.family.name} skill pool (catalog ${catalogIndex().catalog.meta.catalogVersion}).`),
      category: null,
      stat: s.stats.length === 1 ? (s.stats[0] ?? null) : null,
    };
  }
  return { skill: field(s.id, "confirmed"), category: rule.category, stat: ctx.idx.skillStat(ctx.family, ctx.variant, s.id) };
}

function resolveSupport(raw: string, skillId: string | null, ctx: Ctx): ParsedSupport {
  const m = raw.match(SUPPORT_LINE);
  const name = (m?.[1] ?? raw).trim();
  const tierRaw = m?.[2];
  const tierText = tierRaw ? (ROMAN[tierRaw.toUpperCase()] ?? Number(tierRaw)) : null;
  const named = ctx.idx.supportsNamed(name);
  const base = { raw, name, stat: null as string | null };
  if (!named.length) return { ...base, support: field<string>(null, "unknown", "Not a mercenary support in the 3.30 catalog."), tier: field(tierText, tierText ? "confirmed" : "unknown") };

  const first = named[0]!;
  let pick = named;
  let tier: Field<number>;
  if (tierText) {
    pick = named.filter((n) => n.tier === tierText);
    if (!pick.length) {
      return {
        ...base,
        support: field(first.support.id, "ambiguous", `"${name}" is not a Tier ${tierText} name in the catalog.`),
        tier: field(tierText, "ambiguous", `Catalog tier for "${name}": ${named.map((n) => n.tier).join("/")}.`),
      };
    }
    tier = field(tierText, "confirmed");
  } else if (named.length === 1) {
    tier = field(first.tier, "inferred", "Tier not shown; the name exists at one tier only.");
  } else {
    return { ...base, support: field(first.support.id, "ambiguous", "Tier not shown."), tier: field<number>(null, "ambiguous", "Tier not shown.", named.map((n) => n.tier)) };
  }
  const support = pick[0]!.support;
  if (!ctx.family || !skillId) return { ...base, support: field(support.id, "inferred", "Owning skill or family unknown; can't check the binding."), tier };
  const rule = ctx.idx.skillRule(ctx.family, ctx.variant, skillId);
  const allowed = rule && ctx.idx.allowedSupports(rule).find((a) => a.support === support.id);
  if (!allowed || !allowed.tiers.includes(tier.value!)) {
    return { ...base, support: field(support.id, "ambiguous", `Per the catalog, ${support.name} T${tier.value} can't roll on ${ctx.idx.skillName(skillId)}.`), tier };
  }
  return { ...base, support: field(support.id, "confirmed"), tier, stat: ctx.idx.supportStat(ctx.family, ctx.variant, skillId, support.id, tier.value!) };
}

function inferFamily(skillNames: string[], idx: CatalogIndex): CatalogFamily[] {
  const ids = skillNames.map((n) => idx.skill(n)?.id).filter((x): x is string => !!x);
  if (!ids.length) return [];
  return idx.catalog.families.filter((f) => ids.every((id) => idx.skillRule(f, null, id)));
}

export function parseWarrant(text: string, idx: CatalogIndex = catalogIndex()): ParsedWarrant | null {
  if (!looksLikeWarrant(text)) return null;
  const secs = sections(text);
  const out: ParsedWarrant = {
    source: "clipboard",
    mercName: null,
    variant: field<string>(null, "unknown"),
    family: field<string>(null, "unknown"),
    infamous: field<boolean>(null, "unknown"),
    level: field<number>(null, "unknown", "No \"Mercenary Level\" line."),
    warrantType: null,
    skills: [],
    ignored: [],
    unparsed: [],
    problems: [],
  };
  let buildLabel: string | null = null;
  const skillSections: string[][] = [];
  let seenBuild = false;

  for (const sec of secs) {
    const rest: string[] = [];
    for (const line of sec) {
      const build = line.match(/^Build:\s*(.+)$/i);
      const level = line.match(/^Mercenary Level:\s*(\S+)/i);
      if (build) {
        buildLabel = (build[1] ?? "").trim();
        seenBuild = true;
      } else if (level) {
        const n = Number(level[1]);
        out.level = Number.isInteger(n) && n >= 1 && n <= 100 ? field(n, "confirmed") : field<number>(null, "ambiguous", `Unreadable level "${level[1]}".`);
        seenBuild = true;
      } else if (META_LINE.test(line) || FLAG_LINE.test(line) || DESCRIPTION.test(line)) {
        if (!/^(Item Class|Rarity):/i.test(line) && !DESCRIPTION.test(line)) out.ignored.push(line);
      } else if (/^Mercenary Warrant$/i.test(line)) {
        // item base line
      } else rest.push(line);
    }
    if (!rest.length) continue;
    if (!seenBuild && rest.length === 1 && rest[0] && !idx.skill(rest[0])) {
      out.mercName = rest[0];
      continue;
    }
    skillSections.push(rest);
  }

  let ctx: Ctx = { idx, family: null, variant: null };
  if (buildLabel) {
    const hit = idx.build(buildLabel);
    if (hit) {
      ctx = { idx, family: hit.family, variant: hit.variant };
      out.variant = field(hit.variant.id, "confirmed");
      out.family = field(hit.family.id, "confirmed");
      out.infamous = field(hit.variant.infamous, "confirmed");
      out.warrantType = hit.variant.warrantType;
    } else {
      out.problems.push(`Build "${buildLabel}" is not in the 3.30 catalog.`);
      out.family = field<string>(null, "unknown", `Unknown build "${buildLabel}".`);
    }
  }
  if (!ctx.family) {
    const names = skillSections.map((s) => unwrapSkillName(s, idx).name);
    const cands = inferFamily(names, idx);
    const f = cands.length === 1 ? cands[0] : undefined;
    if (f) {
      ctx = { idx, family: f, variant: null };
      out.family = field(f.id, "inferred", "No Build line; the only family whose pools contain every skill.");
      out.variant = field<string>(null, f.variants.length > 1 ? "ambiguous" : "inferred", "Normal or Infamous can't be told without the Build line.", f.variants.map((v) => v.id));
      const only = f.variants.length === 1 ? f.variants[0] : undefined;
      if (only) {
        out.variant = field(only.id, "inferred");
        out.warrantType = only.warrantType;
      }
    } else if (cands.length > 1) {
      out.family = field<string>(null, "ambiguous", "No Build line; several families can roll these skills.", cands.map((c) => c.id));
    }
  }

  for (const sec of skillSections) {
    const { name, used } = unwrapSkillName(sec, idx);
    if (SUPPORT_LINE.test(name)) {
      out.unparsed.push(...sec);
      out.problems.push(`Support lines without a skill: ${sec.join(" / ")}`);
      continue;
    }
    const resolved = resolveSkill(name, ctx);
    const supports = unwrapSupports(sec.slice(used)).map((l) => resolveSupport(l, resolved.skill.value, ctx));
    out.skills.push({ raw: sec.join("\n"), name, ...resolved, supports });
  }
  if (!out.skills.length) out.problems.push("No skills found.");
  validateComposition(out, ctx);
  return out;
}

/** Category counts per PoEDB ("1–3 skills from each category"); a violation is reported, not hidden. */
function validateComposition(w: ParsedWarrant, ctx: Ctx) {
  if (!ctx.family) return;
  const counts: Record<string, number> = {};
  for (const s of w.skills) if (s.category) counts[s.category] = (counts[s.category] ?? 0) + 1;
  for (const [cat, n] of Object.entries(counts)) if (n > 3) w.problems.push(`${n} ${cat} skills — more than the 3 a category allows; check the parse.`);
  const seen = new Set<string>();
  for (const s of w.skills) {
    if (s.skill.value && seen.has(s.skill.value)) w.problems.push(`${s.name} appears twice.`);
    if (s.skill.value) seen.add(s.skill.value);
  }
}

/** A warrant from an official Trade listing: ids come from the listing's stat hashes (exact). */
export function warrantFromListing(l: MercListing, idx: CatalogIndex = catalogIndex()): ParsedWarrant {
  const hit = l.build ? idx.build(l.build) : null;
  const ctx: Ctx = { idx, family: hit?.family ?? null, variant: hit?.variant ?? null };
  const skills: ParsedSkill[] = l.skills.map((s) => {
    const cat = idx.skillByStat.get(s.stat);
    const rule = cat && ctx.family ? idx.skillRule(ctx.family, ctx.variant, cat.id) : null;
    return {
      raw: s.name,
      name: s.name,
      skill: cat ? field(cat.id, rule ? "confirmed" : "ambiguous") : field<string>(null, "unknown"),
      category: rule?.category ?? null,
      stat: s.stat,
      supports: s.supports.map((p) => {
        const sup = idx.supportByStat.get(p.stat);
        return {
          raw: `${p.name} (Tier: ${p.tier})`,
          name: p.name,
          support: sup ? field(sup.support.id, "confirmed") : field<string>(null, "unknown"),
          tier: field(p.tier, "confirmed"),
          stat: p.stat,
        };
      }),
    };
  });
  return {
    source: "trade-listing",
    mercName: null,
    variant: hit ? field(hit.variant.id, "confirmed") : field<string>(null, "unknown"),
    family: hit ? field(hit.family.id, "confirmed") : field<string>(null, "unknown"),
    infamous: hit ? field(hit.variant.infamous, "confirmed") : field<boolean>(null, "unknown"),
    level: l.level ? field(l.level, "confirmed") : field<number>(null, "unknown"),
    warrantType: hit?.variant.warrantType ?? null,
    skills,
    ignored: [],
    unparsed: [],
    problems: [],
  };
}

/** Applies the user's corrections and re-resolves every binding against the catalog. */
export function applyCorrections(w: ParsedWarrant, c: WarrantCorrections, idx: CatalogIndex = catalogIndex()): ParsedWarrant {
  const out: ParsedWarrant = structuredClone(w);
  if (c.variant) {
    const hit = [...idx.variantByBuild.values()].find((v) => v.variant.id === c.variant);
    if (hit) {
      out.variant = { value: hit.variant.id, status: "confirmed", corrected: true };
      out.family = { value: hit.family.id, status: "confirmed", corrected: true };
      out.infamous = { value: hit.variant.infamous, status: "confirmed", corrected: true };
      out.warrantType = hit.variant.warrantType;
    }
  }
  if (c.level && c.level >= 1 && c.level <= 100) out.level = { value: c.level, status: "confirmed", corrected: true };
  const family = out.family.value ? (idx.familyById.get(out.family.value) ?? null) : null;
  const variant = family?.variants.find((v) => v.id === out.variant.value) ?? null;
  const ctx: Ctx = { idx, family, variant };
  out.skills = out.skills.map((s, i) => {
    const sc = c.skills?.[i];
    const skillName = sc?.skill ? idx.skillName(sc.skill) : s.name;
    const resolved = resolveSkill(skillName, ctx);
    if (sc?.skill) resolved.skill = { ...resolved.skill, corrected: true, status: resolved.skill.status === "confirmed" ? "confirmed" : resolved.skill.status };
    const supports = s.supports
      .map((p, j) => {
        const pc = sc?.supports?.[j];
        if (pc === null) return null;
        if (pc) {
          const r = resolveSupport(`${idx.displayOf(pc.support, pc.tier)} (Tier: ${pc.tier})`, resolved.skill.value, ctx);
          return { ...r, raw: p.raw, support: { ...r.support, corrected: true } };
        }
        return resolveSupport(p.raw, resolved.skill.value, ctx);
      })
      .filter((p): p is ParsedSupport => p !== null);
    return { ...s, name: skillName, ...resolved, supports };
  });
  out.problems = out.problems.filter((p) => !/not in the 3\.30 catalog|No Build line/.test(p) || !c.variant);
  return out;
}

export interface BindingCheck {
  certain: boolean;
  reasons: string[];
}

/** Whether every value-relevant field is confirmed (a high-confidence price needs this). */
export function bindingCheck(w: ParsedWarrant): BindingCheck {
  const reasons: string[] = [];
  if (w.family.status !== "confirmed") reasons.push("Family is not confirmed.");
  if (w.variant.status !== "confirmed") reasons.push("Normal / Infamous is not confirmed.");
  if (w.level.status !== "confirmed") reasons.push("Mercenary level is not confirmed.");
  for (const s of w.skills) {
    if (s.skill.status !== "confirmed") reasons.push(`${s.name}: ${s.skill.note ?? "skill not confirmed"}`);
    for (const p of s.supports) {
      if (p.support.status !== "confirmed" || p.tier.status !== "confirmed") reasons.push(`${s.name} → ${p.name}: ${p.support.note ?? p.tier.note ?? "binding not confirmed"}`);
    }
  }
  return { certain: reasons.length === 0, reasons };
}

/** Canonical key: variant, level, skills (sorted) with their own supports (sorted). */
export function fingerprint(w: ParsedWarrant): string {
  const skills = w.skills
    .map((s) => `${s.skill.value ?? `?${s.name}`}[${s.supports.map((p) => `${p.support.value ?? `?${p.name}`}:${p.tier.value ?? "?"}`).sort().join(",")}]`)
    .sort();
  return `${w.variant.value ?? w.family.value ?? "?"}@${w.level.value ?? "?"}|${skills.join("|")}`;
}
