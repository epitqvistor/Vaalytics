/**
 * Valuation from comparable listings. A price never comes from a score: it is the distribution
 * of comparable asking prices on the official Trade site, labelled with its comparison level,
 * sample size, freshness and confidence. Asking prices are not sales — every price here is an
 * estimate built from asks.
 */
import type { MercListing, MercSearchOutcome } from "@/core/ipc/commands";
import { catalogIndex } from "./catalog";
import { bindingCheck, warrantFromListing } from "./parse";
import { LEVEL_LABEL, packagePresent, valueSkill, type Level } from "./query";
import { appliedSkillRules, DEFAULT_THRESHOLDS, evidenceById, effectiveRules as rulesFor, sampleClass, type FamilyRules, type SampleClass, type SampleThresholds } from "./rules";
import type { ParsedSkill, ParsedWarrant } from "./types";

// ---------- matching ----------

export type MatchKind = "exact" | "package" | "similar" | "other";

const skillKey = (s: ParsedSkill) => s.skill.value ?? `?${s.name}`;
const supportKeys = (s: ParsedSkill) => s.supports.map((p) => `${p.support.value ?? p.name}:${p.tier.value}`).sort().join(",");

/** How a listing compares with the warrant, checked on the listing's full skill data. */
export function matchListing(w: ParsedWarrant, l: MercListing): { kind: MatchKind; differences: string[] } {
  const lw = warrantFromListing(l);
  const differences: string[] = [];
  if (lw.variant.value !== w.variant.value) differences.push(lw.infamous.value ? "Infamous" : "not Infamous");
  const mine = new Map(w.skills.map((s) => [skillKey(s), s]));
  const theirs = new Map(lw.skills.map((s) => [skillKey(s), s]));
  for (const [k, s] of mine) {
    const t = theirs.get(k);
    if (!t) differences.push(`no ${s.name}`);
    else if (supportKeys(t) !== supportKeys(s)) differences.push(`${s.name}: different supports`);
  }
  for (const [k, t] of theirs) if (!mine.has(k)) differences.push(`extra ${t.name}`);
  if (w.level.value && lw.level.value && lw.level.value !== w.level.value) differences.push(`level ${lw.level.value}`);
  if (!differences.length) return { kind: "exact", differences };
  const rules = rulesFor(w.family.value);
  const carrier = valueSkill(w, rules);
  if (carrier?.pkg && packagePresent(lw, carrier.pkg)) return { kind: "package", differences };
  if (carrier && theirs.has(skillKey(carrier.skill))) return { kind: "similar", differences };
  return { kind: "other", differences };
}

// ---------- statistics ----------

export interface Exclusion {
  id: string;
  reason: string;
  amount: number | null;
  currency: string | null;
}

export interface PriceStats {
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

/** Linear-interpolated quantile of a sorted array. */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  return a + (sorted[hi]! - a) * (pos - lo);
}

export function stats(values: number[]): PriceStats | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return { count: s.length, min: s[0]!, p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75), max: s[s.length - 1]! };
}

export const MAX_DIVINE_ASK = 1000;

export interface Filtered {
  kept: { listing: MercListing; chaos: number; match: MatchKind; differences: string[] }[];
  excluded: Exclusion[];
}

/**
 * Relevance and outlier filtering, every exclusion with its reason:
 * - no price / no conversion rate / mirror asks (aspirational, can't be converted reliably);
 * - asks of 1,000 divine or more (placeholder prices);
 * - for level 1, listings that aren't the exact configuration;
 * - high outliers: above Q3 + 3·IQR on log prices (only with ≥ 8 asks).
 */
export function filterComparables(w: ParsedWarrant, level: Level, listings: MercListing[], divine: number | null): Filtered {
  const excluded: Exclusion[] = [];
  const kept: Filtered["kept"] = [];
  for (const l of listings) {
    const ex = (reason: string) => excluded.push({ id: l.id, reason, amount: l.amount, currency: l.currency });
    if (l.amount == null || !l.currency) {
      ex("No price on the listing.");
      continue;
    }
    if (l.currency === "mirror") {
      ex("Mirror ask — aspirational and not convertible reliably; excluded as in the PoEMercPricer survey.");
      continue;
    }
    if (l.amountChaos == null) {
      ex(`No conversion rate for "${l.currency}".`);
      continue;
    }
    if (divine && l.amountChaos >= MAX_DIVINE_ASK * divine) {
      ex(`Ask of ${MAX_DIVINE_ASK}+ divine — treated as a placeholder.`);
      continue;
    }
    const m = matchListing(w, l);
    if (level === 1 && m.kind !== "exact") {
      ex(`Not the exact configuration (${m.differences.slice(0, 3).join(", ")}).`);
      continue;
    }
    kept.push({ listing: l, chaos: l.amountChaos, match: m.kind, differences: m.differences });
  }
  if (kept.length >= 8) {
    const logs = kept.map((k) => Math.log(k.chaos)).sort((a, b) => a - b);
    const q1 = quantile(logs, 0.25);
    const q3 = quantile(logs, 0.75);
    const fence = q3 + 3 * Math.max(q3 - q1, 0.1);
    for (let i = kept.length - 1; i >= 0; i--) {
      if (Math.log(kept[i]!.chaos) > fence) {
        const k = kept.splice(i, 1)[0]!;
        excluded.push({ id: k.listing.id, reason: "High outlier (above Q3 + 3×IQR of log prices).", amount: k.listing.amount, currency: k.listing.currency });
      }
    }
  }
  return { kept, excluded };
}

// ---------- freshness ----------

export type Freshness = "fresh" | "recent" | "stale" | "very-stale" | "unavailable";
export const FRESHNESS_LABEL: Record<Freshness, string> = {
  fresh: "Fresh",
  recent: "Recently updated",
  stale: "Stale",
  "very-stale": "Very stale",
  unavailable: "Unavailable",
};

/** fresh < 15 min · recently updated < 2 h · stale < 24 h · very stale ≥ 24 h. A failed refresh is never fresh. */
export function freshness(o: Pick<MercSearchOutcome, "fetchedAt" | "stale" | "status" | "listings" | "total"> | null, nowSec: number): Freshness {
  if (!o || (o.status === "error" && !o.stale)) return "unavailable";
  const age = nowSec - o.fetchedAt;
  let f: Freshness = age < 15 * 60 ? "fresh" : age < 2 * 3600 ? "recent" : age < 24 * 3600 ? "stale" : "very-stale";
  if (o.stale && (f === "fresh" || f === "recent")) f = "stale";
  return f;
}

// ---------- valuation ----------

export type Confidence = "high" | "medium" | "low" | "insufficient";
export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low", insufficient: "Insufficient data" };

export type Category = "premium" | "high" | "check" | "common" | "low" | "potential-premium" | "unknown";
export const CATEGORY_LABEL: Record<Category, string> = {
  premium: "Premium",
  high: "High value",
  check: "Worth price checking",
  common: "Common",
  low: "Low value",
  "potential-premium": "Potential premium — needs price check",
  unknown: "Unknown",
};

export interface LevelResult {
  level: Level;
  label: string;
  outcome: MercSearchOutcome | null;
  filtered: Filtered | null;
  raw: PriceStats | null;
  stats: PriceStats | null;
  sample: SampleClass;
  freshness: Freshness;
}

export interface Factor {
  id: string;
  kind: "rule" | "observation" | "binding" | "market" | "source";
  effect: "positive" | "negative" | "neutral" | "limits";
  text: string;
  evidence: string[];
}

export interface Valuation {
  levels: LevelResult[];
  chosen: LevelResult | null;
  confidence: Confidence;
  confidenceReasons: string[];
  category: Category;
  categoryReasons: string[];
  /** All prices in chaos; `null` when there's no basis. */
  askingRange: [number, number] | null;
  suggested: number | null;
  quickSale: number | null;
  divineRate: number | null;
  indicators: { quality: Indicator; demand: Indicator; scarcity: Indicator };
  factors: Factor[];
}

export interface Indicator {
  label: string;
  level: "high" | "medium" | "low" | "unknown";
  text: string;
}

const LEVEL_CAP: Record<Level, Confidence> = { 1: "high", 2: "high", 3: "medium", 4: "low" };
const ORDER: Confidence[] = ["insufficient", "low", "medium", "high"];
const lower = (a: Confidence, b: Confidence) => (ORDER.indexOf(a) < ORDER.indexOf(b) ? a : b);
const down = (c: Confidence): Confidence => (c === "high" ? "medium" : c === "medium" ? "low" : c);

export function divineRate(outcomes: (MercSearchOutcome | null)[]): number | null {
  for (const o of outcomes) if (o?.rates?.divine && o.rates.divine > 0) return o.rates.divine;
  return null;
}

/** Round to sensible asking steps: whole chaos below 1 div, then 0.5 div steps, then whole divines. */
export function roundAsk(chaos: number, divine: number | null): number {
  if (!divine || chaos < divine) return Math.max(1, Math.round(chaos));
  const d = chaos / divine;
  const step = d < 20 ? 0.5 : 1;
  return Math.round(d / step) * step * divine;
}

export function value(w: ParsedWarrant, outcomes: Partial<Record<Level, MercSearchOutcome | null>>, nowSec: number, thresholds: SampleThresholds = DEFAULT_THRESHOLDS): Valuation {
  const divine = divineRate(Object.values(outcomes));
  const levels: LevelResult[] = ([1, 2, 3, 4] as Level[])
    .filter((lv) => lv in outcomes)
    .map((lv) => {
      const o = outcomes[lv] ?? null;
      const filtered = o && o.listings ? filterComparables(w, lv, o.listings, divine) : null;
      const rawVals = (o?.listings ?? []).map((l) => l.amountChaos).filter((x): x is number => x != null);
      const st = filtered ? stats(filtered.kept.map((k) => k.chaos)) : null;
      return { level: lv, label: LEVEL_LABEL[lv], outcome: o, filtered, raw: stats(rawVals), stats: st, sample: sampleClass(st?.count ?? 0, thresholds), freshness: freshness(o, nowSec) };
    });

  const usable = levels.filter((l) => l.stats && l.sample !== "insufficient" && l.freshness !== "unavailable");
  const chosen = usable[0] ?? levels.find((l) => l.stats) ?? null;
  const reasons: string[] = [];
  let confidence: Confidence = "insufficient";
  if (chosen?.stats && chosen.sample !== "insufficient") {
    confidence = chosen.sample === "stronger" || chosen.sample === "moderate" ? "high" : chosen.sample === "limited" ? "medium" : "low";
    reasons.push(`${chosen.stats.count} comparable asks (${chosen.sample}) at level ${chosen.level}, ${chosen.label.toLowerCase()}.`);
    if (lower(confidence, LEVEL_CAP[chosen.level]) !== confidence) reasons.push(`Level ${chosen.level} caps confidence at ${CONFIDENCE_LABEL[LEVEL_CAP[chosen.level]]}.`);
    confidence = lower(confidence, LEVEL_CAP[chosen.level]);
    if (chosen.sample === "moderate" && confidence === "high") {
      // 15–29 asks: high only with a tight spread.
      if (chosen.stats.p75 > 2.5 * chosen.stats.p25) {
        confidence = "medium";
        reasons.push("Wide spread between p25 and p75.");
      }
    } else if (chosen.stats.p75 > 4 * chosen.stats.p25) {
      confidence = down(confidence);
      reasons.push("Very wide spread between p25 and p75.");
    }
    if (chosen.freshness === "stale") {
      confidence = down(confidence);
      reasons.push("Data is stale.");
    } else if (chosen.freshness === "very-stale") {
      confidence = lower(confidence, "low");
      reasons.push("Data is very stale.");
    }
    if (chosen.outcome?.stale) reasons.push("The last refresh failed; these are older listings.");
  } else {
    reasons.push(chosen ? `Only ${chosen.stats?.count ?? 0} comparable asks — below the ${thresholds.exploratory} needed.` : "No comparable listings retrieved.");
  }
  const binding = bindingCheck(w);
  if (!binding.certain) {
    if (confidence !== "insufficient") confidence = lower(confidence, "low");
    reasons.push(`Uncertain fields cap confidence at Low: ${binding.reasons.slice(0, 2).join(" ")}`);
  }
  if (!divine) reasons.push("No divine rate from poe.ninja — divine asks could not be compared.");

  const s = confidence !== "insufficient" ? chosen?.stats ?? null : null;
  const askingRange: [number, number] | null = s ? [roundAsk(s.p25, divine), roundAsk(s.p75, divine)] : null;
  const suggested = s ? roundAsk(s.median, divine) : null;
  const quickSale = s ? roundAsk(Math.max(s.min, s.p25 * 0.85), divine) : null;

  const rules = rulesFor(w.family.value);
  const factors = explain(w, rules, levels, binding.reasons);
  const { category, categoryReasons } = categorize(w, rules, chosen, confidence, divine);
  return {
    levels,
    chosen,
    confidence,
    confidenceReasons: reasons,
    category,
    categoryReasons,
    askingRange,
    suggested,
    quickSale,
    divineRate: divine,
    indicators: indicators(w, rules, levels),
    factors,
  };
}

function categorize(w: ParsedWarrant, rules: FamilyRules | null, chosen: LevelResult | null, confidence: Confidence, divine: number | null): { category: Category; categoryReasons: string[] } {
  const out: string[] = [];
  const premium = rules?.premium;
  const negatives = appliedSkillRules(rules).filter((r) => r.effect === "negative" && r.status === "active" && w.skills.some((s) => s.skill.value === r.skill));
  const premiumConditions =
    !!premium && packagePresent(w, premium.package) && premium.partners.every((p) => w.skills.some((s) => s.skill.value === p)) && (!premium.withoutNegatives || negatives.length === 0);
  if (premiumConditions) out.push("Every premium condition of the family rule holds.");
  if (confidence === "insufficient" || !chosen?.stats) {
    if (premiumConditions) return { category: "potential-premium", categoryReasons: [...out, "Not enough comparable asks to confirm it — price check it."] };
    return { category: "unknown", categoryReasons: ["Not enough comparable asks."] };
  }
  if (!divine) return { category: "unknown", categoryReasons: ["No divine rate, so value bands can't be applied."] };
  const med = chosen.stats.median / divine;
  out.push(`Comparable median ≈ ${med.toFixed(med < 10 ? 1 : 0)} div (level ${chosen.level}).`);
  if (premiumConditions) {
    const strong = chosen.level <= 2 && chosen.stats.count >= 8;
    if (strong && med >= 50) return { category: "premium", categoryReasons: out };
    if (!strong) return { category: "potential-premium", categoryReasons: [...out, "Premium needs ≥ 8 level 1–2 comparables at ≥ 50 div."] };
    // Enough comparables, and they price it below premium: the evidence wins over the rule.
    out.push("The premium package is present, but comparable asks price it below 50 div.");
  }
  if (med >= 15) return { category: "high", categoryReasons: out };
  if (med >= 1) return { category: "check", categoryReasons: out };
  if (med >= 0.2) return { category: "common", categoryReasons: out };
  return { category: "low", categoryReasons: out };
}

function explain(w: ParsedWarrant, rules: FamilyRules | null, levels: LevelResult[], bindingReasons: string[]): Factor[] {
  const idx = catalogIndex();
  const f: Factor[] = [];
  if (rules) {
    f.push({ id: `tier:${rules.family}`, kind: "rule", effect: "neutral", text: `Family market tier (survey of asks): ${rules.tier}.`, evidence: [rules.tierEvidence] });
    const carrier = valueSkill(w, rules);
    for (const pkg of rules.packages) {
      const present = packagePresent(w, pkg);
      const onWarrant = w.skills.some((s) => s.skill.value === pkg.skill);
      const gates = pkg.gates.map((g) => `${idx.supportById.get(g.support)?.name ?? g.support} T${g.minTier}+`).join(" + ");
      f.push({
        id: `package:${pkg.skill}`,
        kind: "rule",
        effect: present ? "positive" : onWarrant ? "neutral" : "negative",
        text: present
          ? `Value package present: ${idx.skillName(pkg.skill)}${gates ? ` with ${gates}` : ""}.`
          : onWarrant
            ? `${idx.skillName(pkg.skill)} is present but the package (${gates}) is incomplete.`
            : `No ${idx.skillName(pkg.skill)} — the family's measured value skill.`,
        evidence: pkg.evidence,
      });
    }
    if (carrier && !carrier.pkg) f.push({ id: "carrier", kind: "rule", effect: "neutral", text: `Searched around ${idx.skillName(carrier.skill.skill.value!)} (strongest supports; no measured package).`, evidence: rules.packages.length ? [] : ["pmp-generic"] });
    for (const r of rules.skills) {
      const present = w.skills.some((s) => s.skill.value === r.skill);
      if (!present && r.effect === "positive") continue;
      if (!present && r.status !== "active") continue;
      const status = r.status === "contradicted" ? " (contradicted — not applied)" : r.status === "unverified" ? " (unverified — matched in searches, not assumed)" : "";
      f.push({
        id: r.id,
        kind: "rule",
        effect: r.status === "contradicted" ? "neutral" : present ? r.effect : "positive",
        text: present ? `${idx.skillName(r.skill)}: ${r.reason}${status}` : `No ${idx.skillName(r.skill)} (a known downside for this family).`,
        evidence: r.evidence,
      });
    }
    if (rules.note) f.push({ id: `note:${rules.family}`, kind: "rule", effect: "neutral", text: rules.note, evidence: [] });
  }
  for (const r of bindingReasons.slice(0, 6)) f.push({ id: `binding:${r}`, kind: "binding", effect: "limits", text: r, evidence: [] });
  for (const l of levels) {
    if (!l.outcome) continue;
    if (l.outcome.status === "error") f.push({ id: `err:${l.level}`, kind: "source", effect: "limits", text: `Level ${l.level}: ${l.outcome.error}`, evidence: [] });
    else
      f.push({
        id: `market:${l.level}`,
        kind: "market",
        effect: "neutral",
        text: `Level ${l.level} (${l.label}): ${l.outcome.total ?? 0} listings on Trade; lowest ${l.outcome.listings.length} fetched, ${l.stats?.count ?? 0} kept, ${l.filtered?.excluded.length ?? 0} excluded.`,
        evidence: [],
      });
  }
  return f.filter((x) => x.evidence.every((e) => evidenceById.has(e)));
}

function indicators(w: ParsedWarrant, rules: FamilyRules | null, levels: LevelResult[]): Valuation["indicators"] {
  const carrier = valueSkill(w, rules);
  let quality: Indicator = { label: "Combination quality", level: "unknown", text: "No measured value package for this family." };
  if (rules?.packages.length) {
    const pkg = rules.packages[0]!;
    const present = packagePresent(w, pkg);
    const negatives = appliedSkillRules(rules).filter((r) => r.effect === "negative" && r.status === "active" && w.skills.some((s) => s.skill.value === r.skill));
    quality = present
      ? { label: "Combination quality", level: negatives.length ? "medium" : "high", text: negatives.length ? "Value package present, with a known downside." : "Value package present on its own skill." }
      : carrier?.pkg
        ? { label: "Combination quality", level: "medium", text: "Value skill present, package incomplete." }
        : { label: "Combination quality", level: "low", text: "The family's value skill is missing." };
  }
  const tier = rules?.tier ?? "no-data";
  const demand: Indicator =
    tier === "no-data"
      ? { label: "Demand", level: "unknown", text: "No sales data exists; no survey data for this family." }
      : { label: "Demand", level: tier === "premium" ? "high" : tier === "high" ? "medium" : "low", text: `From the family tier in a survey of asks (${tier}) — not sales.` };
  const pkgLevel = levels.find((l) => l.level === 2 && l.outcome?.status === "ok") ?? levels.find((l) => l.level === 3 && l.outcome?.status === "ok");
  const total = pkgLevel?.outcome?.total;
  const searched = levels.some((l) => l.outcome);
  const scarcity: Indicator =
    total == null
      ? { label: "Scarcity", level: "unknown", text: searched ? "The package search failed or wasn't run." : "Not searched yet." }
      : { label: "Scarcity", level: total < 10 ? "high" : total < 50 ? "medium" : "low", text: `${total} listings match the value package (level ${pkgLevel!.level}).` };
  return { quality, demand, scarcity };
}
