/**
 * Search plans for the official Trade site. Measured on Covens (2026-11-26, anonymous):
 * - one bound `mercenary` group per search (skill + its supports); a second is refused
 *   ("Query is too complex … Logging in will increase this limit");
 * - `and` / `not` groups with skill stats can be added next to it (skill presence / absence);
 * - the server reports `complexity`; 49 was accepted and a query estimated at 52 was refused.
 *   Estimate: 4 + (bound group: 30 + 2 per filter) + (each and/not group: 2 + 1 per extra filter)
 *   + 3 for the level (ilvl) filter — the +3 was found in live calibration, where every query with
 *   the level filter reported exactly 3 more than the estimate without it.
 * So a full-warrant match can never be one anonymous query: other skills' supports can't be
 * bound. "Exact warrant" comparables are therefore verified per listing (match.ts).
 */
import { catalogIndex, type CatalogIndex } from "./catalog";
import type { MercSearchRequest } from "@/core/ipc/commands";
import type { ParsedSkill, ParsedWarrant } from "./types";
import { appliedSkillRules, effectiveRules as rulesFor, type FamilyRules, type ValuePackage } from "./rules";

export const COMPLEXITY_BUDGET = 49;
export const LISTINGS_PER_SEARCH = 20;
export type Level = 1 | 2 | 3 | 4;

export const LEVEL_LABEL: Record<Level, string> = {
  1: "Exact warrant",
  2: "Exact value package",
  3: "Similar configuration",
  4: "Family baseline",
};

export interface SearchPlan {
  level: Level;
  label: string;
  /** What the query requires, in words. */
  constraints: string[];
  /** Constraints that could not be included (budget / unknown ids). Never hidden. */
  dropped: string[];
  complexity: number;
  request: Omit<MercSearchRequest, "gameVersion" | "catalogVersion">;
}

export function estimateComplexity(bound: number, groups: number[], levelFilter = false): number {
  return 4 + (levelFilter ? 3 : 0) + (bound ? 30 + 2 * bound : 0) + groups.reduce((s, n) => s + (n ? 2 + (n - 1) : 0), 0);
}

interface Group {
  type: "mercenary" | "and" | "not";
  filters: { id: string }[];
}

function baseQuery(w: ParsedWarrant, stats: Group[]) {
  const q: Record<string, unknown> = {
    status: { option: "securable" },
    type: { option: w.warrantType, discriminator: "mercenary_warrant" },
    stats,
  };
  if (w.level.status === "confirmed" && w.level.value) q.filters = { misc_filters: { filters: { ilvl: { min: w.level.value } } } };
  return { query: q, sort: { price: "asc" } };
}

/** Value carrier: first rule package present on the warrant, else the skill with the strongest supports. */
export function valueSkill(w: ParsedWarrant, rules: FamilyRules | null): { skill: ParsedSkill; pkg: ValuePackage | null } | null {
  for (const pkg of rules?.packages ?? []) {
    const s = w.skills.find((x) => x.skill.value === pkg.skill && x.skill.status === "confirmed");
    if (s) return { skill: s, pkg };
  }
  const scored = w.skills
    .filter((s) => s.skill.status === "confirmed" && s.stat)
    .map((s) => ({ s, score: s.supports.reduce((n, p) => n + (p.stat ? (p.tier.value ?? 0) : 0), 0) }))
    .sort((a, b) => b.score - a.score);
  return scored[0] ? { skill: scored[0].s, pkg: null } : null;
}

const meetsGate = (s: ParsedSkill, support: string, minTier: number) => s.supports.some((p) => p.support.value === support && (p.tier.value ?? 0) >= minTier && p.stat);

export function packagePresent(w: ParsedWarrant, pkg: ValuePackage): boolean {
  const s = w.skills.find((x) => x.skill.value === pkg.skill);
  return !!s && pkg.gates.every((g) => meetsGate(s, g.support, g.minTier));
}

export function planSearches(w: ParsedWarrant, idx: CatalogIndex = catalogIndex(), budget = COMPLEXITY_BUDGET): { plans: SearchPlan[]; problems: string[] } {
  const problems: string[] = [];
  if (!w.warrantType || w.family.status === "unknown" || w.variant.value === null) {
    return { plans: [], problems: ["The warrant type is not known (family or Normal/Infamous unresolved) — correct it to search."] };
  }
  const rules = rulesFor(w.family.value);
  const carrier = valueSkill(w, rules);
  const skillName = (id: string | null) => (id ? idx.skillName(id) : "?");
  const others = w.skills.filter((s) => s !== carrier?.skill && s.stat && s.skill.status === "confirmed");
  const ruleSkills = appliedSkillRules(rules);
  const has = (skill: string) => w.skills.some((s) => s.skill.value === skill);
  const statOf = (skill: string) => {
    const f = idx.familyById.get(w.family.value!);
    return f ? idx.skillStat(f, null, skill) : null;
  };
  const plans: SearchPlan[] = [];

  const make = (level: Level, bound: { skill: ParsedSkill; supports: ParsedSkill["supports"] } | null, andSkills: string[], notSkills: string[], constraints: string[]): SearchPlan => {
    const dropped: string[] = [];
    const stats: Group[] = [];
    let boundFilters: { id: string }[] = [];
    if (bound?.skill.stat) {
      boundFilters = [{ id: bound.skill.stat }, ...bound.supports.filter((p) => p.stat).map((p) => ({ id: p.stat! }))];
      for (const p of bound.supports) if (!p.stat) dropped.push(`${skillName(bound.skill.skill.value)} → ${p.name}: no verified stat id`);
    }
    // Trim to the complexity budget: drop `not`, then trailing `and` skills, then the weakest bound supports.
    let ands = andSkills.map((id) => ({ id, stat: statOf(id) })).filter((x) => x.stat);
    let nots = notSkills.map((id) => ({ id, stat: statOf(id) })).filter((x) => x.stat);
    const levelFilter = w.level.status === "confirmed" && !!w.level.value;
    const cost = () => estimateComplexity(boundFilters.length, [ands.length, nots.length], levelFilter);
    while (cost() > budget && (ands.length || nots.length || boundFilters.length > 1)) {
      if (ands.length) dropped.push(`also has ${skillName(ands.pop()!.id)}`);
      else if (nots.length) dropped.push(`excludes ${skillName(nots.pop()!.id)}`);
      else {
        const f = boundFilters.pop()!;
        const p = bound?.supports.find((x) => x.stat === f.id);
        dropped.push(`${skillName(bound?.skill.skill.value ?? null)} → ${p?.name ?? f.id}`);
      }
    }
    if (boundFilters.length) stats.push({ type: "mercenary", filters: boundFilters });
    if (ands.length) stats.push({ type: "and", filters: ands.map((a) => ({ id: a.stat! })) });
    if (nots.length) stats.push({ type: "not", filters: nots.map((a) => ({ id: a.stat! })) });
    if (!stats.length) {
      // Family baseline: the warrant type alone. The Trade API wants a stats array; an empty one is fine.
    }
    return {
      level,
      label: LEVEL_LABEL[level],
      constraints,
      dropped,
      complexity: cost(),
      request: { query: baseQuery(w, stats) as unknown as Record<string, unknown>, level, label: `${LEVEL_LABEL[level]} — ${constraints.join("; ") || "warrant type"}`.slice(0, 160), count: LISTINGS_PER_SEARCH },
    };
  };

  const negativesAbsent = ruleSkills.filter((r) => r.effect === "negative" && !has(r.skill)).map((r) => r.skill);
  const negativesPresent = ruleSkills.filter((r) => r.effect === "negative" && has(r.skill)).map((r) => r.skill);
  const partnersPresent = ruleSkills.filter((r) => r.effect === "positive" && has(r.skill)).map((r) => r.skill);
  const variantWord = w.infamous.value ? "Infamous" : "normal";

  if (carrier) {
    const cs = carrier.skill;
    const cname = skillName(cs.skill.value);
    // L1: candidates for an exact match — carrier with all its supports, plus every other skill present.
    plans.push(
      make(
        1,
        { skill: cs, supports: cs.supports },
        others.map((s) => s.skill.value!),
        [],
        [`${cname} with all ${cs.supports.length} supports at their tiers`, `all ${others.length} other skills present`, `${variantWord} warrant`, "each listing then checked for the full configuration"],
      ),
    );
    // L2: the value package (rule gates at the warrant's own tiers), same value-relevant skills, same negatives.
    const gateSupports = carrier.pkg ? cs.supports.filter((p) => carrier.pkg!.gates.some((g) => g.support === p.support.value)) : cs.supports.filter((p) => (p.tier.value ?? 0) >= 3);
    plans.push(
      make(
        2,
        { skill: cs, supports: gateSupports },
        [...negativesPresent, ...partnersPresent],
        negativesAbsent,
        [
          `${cname}${gateSupports.length ? ` with ${gateSupports.map((p) => `${p.name} T${p.tier.value}`).join(" + ")}` : ""}`,
          ...partnersPresent.map((s) => `with ${skillName(s)}`),
          ...negativesPresent.map((s) => `with ${skillName(s)} (same downside)`),
          ...negativesAbsent.map((s) => `without ${skillName(s)}`),
        ],
      ),
    );
    // L3: similar — the carrier skill with only its value supports (package gates, else its two
    // strongest T3 supports); no other-skill constraints.
    const strong = carrier.pkg ? gateSupports : cs.supports.filter((p) => (p.tier.value ?? 0) >= 3).slice(0, 2);
    plans.push(make(3, { skill: cs, supports: strong }, [], [], [`${cname}${strong.length ? ` with ${strong.map((p) => `${p.name} T${p.tier.value}`).join(" + ")}` : ""}`]));
  } else {
    problems.push("No skill could be confirmed with an official stat id, so only the family baseline can be searched.");
  }
  plans.push(make(4, null, [], [], []));
  // De-duplicate identical queries (e.g. L2 = L3 when the package is just the strong supports).
  const seen = new Set<string>();
  return {
    plans: plans.filter((p) => {
      const k = JSON.stringify(p.request.query);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
    problems,
  };
}

/** Link to the same search on the official Trade site (opens the query, nothing is sent from here). */
export function tradeSiteUrl(league: string, query: Record<string, unknown>) {
  return `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}?q=${encodeURIComponent(JSON.stringify((query as { query: unknown }).query))}`;
}
