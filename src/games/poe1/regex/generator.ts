/**
 * Turns a generator selection into an in-game search string, checks every
 * piece against the category corpus, and splits strings that exceed the
 * 250-character box into several searches (never truncates).
 */
import type { Category, Option, PropValue } from "./categories";
import { atLeast, build, compile, LIMIT, parseQuery, termText, type Term } from "./syntax";

export interface GenState {
  want: string[];
  wantMode: "any" | "all";
  avoid: string[];
  /** Option id → minimum value (wanted options only). */
  mins: Record<string, number>;
  props: Record<string, PropValue>;
  /** Terms kept verbatim (from reverse lookup: fragments no option explains). */
  extra: string[];
}

export const emptyState = (): GenState => ({ want: [], wantMode: "any", avoid: [], mins: {}, props: {}, extra: [] });

export type IssueKind = "ambiguous" | "noMin" | "falsePositive" | "unverified" | "tooLong" | "split" | "invalid";
export interface Issue {
  kind: IssueKind;
  message: string;
  optionId?: string;
}

export interface Piece {
  optionId: string;
  regex: string;
  /** Other options this piece also matches (false positives in the corpus). */
  alsoMatches: string[];
}

export interface Generated {
  query: string;
  terms: Term[];
  pieces: Piece[];
  issues: Issue[];
}

/** Regex for one option, optionally "value ≥ min". */
export function pieceFor(cat: Category, o: Option, min?: number): { regex: string | null; issue?: Issue } {
  if (o.fixed) {
    if (min && min > 0 && o.fixedMin) return { regex: o.fixedMin(min) };
    return { regex: o.fixed };
  }
  if (min && min > 0 && o.numeric) {
    const after = cat.index.afterNumberFor(o.id, o.lines);
    if (after) return { regex: atLeast(min) + after.regex };
    const frag = cat.index.fragmentFor(o.id, o.lines);
    return {
      regex: frag?.regex ?? null,
      issue: { kind: "noMin", optionId: o.id, message: `“${o.label}”: the minimum can't be expressed uniquely; matching any value.` },
    };
  }
  const frag = cat.index.fragmentFor(o.id, o.lines);
  if (frag) return { regex: frag.regex };
  return { regex: null, issue: { kind: "ambiguous", optionId: o.id, message: `“${o.label}”: no text separates it from other lines; left out.` } };
}

/** Options (other than `own`) whose lines `regex` matches. */
export function falsePositives(cat: Category, regex: string, own: string): string[] {
  const re = compile(regex);
  if (!re) return [];
  return [...cat.index.ownersMatching(re)].filter((o) => o !== own);
}

export function generate(cat: Category, st: GenState): Generated {
  const byId = new Map(cat.options.map((o) => [o.id, o]));
  const issues: Issue[] = [];
  const pieces: Piece[] = [];
  const terms: Term[] = [];

  for (const p of cat.props) {
    const v = st.props[p.id];
    const t = p.term(v ?? null, st.props);
    if (!t) continue;
    terms.push(t);
    if (p.unverified) issues.push({ kind: "unverified", message: `${p.label}: ${p.unverified}` });
  }

  const piecesOf = (ids: string[], withMin: boolean) => {
    const alts: string[] = [];
    for (const id of ids) {
      const o = byId.get(id);
      if (!o) continue;
      const { regex, issue } = pieceFor(cat, o, withMin ? st.mins[id] : undefined);
      if (issue) issues.push(issue);
      if (!regex) continue;
      const also = falsePositives(cat, regex, o.id);
      if (also.length && !o.fixed)
        issues.push({
          kind: "falsePositive",
          optionId: o.id,
          message: `“${o.label}” also matches ${also.length} other line${also.length > 1 ? "s" : ""} (e.g. “${also[0] ? (byId.get(also[0])?.label ?? "another line") : "a base name or property line"}”).`,
        });
      pieces.push({ optionId: o.id, regex, alsoMatches: also });
      alts.push(regex);
    }
    return alts;
  };

  const avoidAlts = piecesOf(st.avoid, false);
  if (avoidAlts.length) terms.push({ negate: true, alts: avoidAlts });

  const wantAlts = piecesOf(st.want, true);
  if (wantAlts.length) {
    if (st.wantMode === "any") terms.push({ alts: wantAlts });
    else for (const a of wantAlts) terms.push({ alts: [a] });
  }

  for (const raw of st.extra) terms.push(...parseQuery(raw));

  for (const t of terms) if (!compile(t.alts.join("|"))) issues.push({ kind: "invalid", message: `Not a valid pattern: ${termText(t)}` });

  const query = build(terms);
  return { query, terms, pieces, issues };
}

// ---------- 250-character limit ----------

export type SplitMode = "single" | "any" | "all";
export interface SplitResult {
  /** Searches, each ≤ LIMIT, or empty when it can't be split cleanly. */
  parts: string[];
  /**
   * single = fits; any = an item matching ANY of the searches is wanted;
   * all = an item is wanted only if it passes EVERY search.
   */
  mode: SplitMode;
  error: string | null;
}

/** Splits a query that is longer than the search box. Never drops a term. */
export function splitQuery(query: string, limit = LIMIT): SplitResult {
  if (query.length <= limit) return { parts: query ? [query] : [], mode: "single", error: null };
  const terms = parseQuery(query);
  const texts = terms.map(termText);
  const over = texts.map((t, i) => (t.length > limit ? i : -1)).filter((i) => i >= 0);

  if (over.length === 0) {
    // Every term fits: pack terms; every search must pass.
    const parts: string[] = [];
    let cur = "";
    for (const t of texts) {
      if (!cur) cur = t;
      else if (cur.length + 1 + t.length <= limit) cur += " " + t;
      else {
        parts.push(cur);
        cur = t;
      }
    }
    if (cur) parts.push(cur);
    return { parts, mode: "all", error: null };
  }
  if (over.length > 1) return { parts: [], mode: "all", error: "More than one term is longer than 250 characters; it can't be split without changing its meaning. Select fewer options." };

  // One long OR term: split its alternatives; the other terms go into every search.
  const i = over[0]!;
  const big = terms[i]!;
  const rest = texts.filter((_, j) => j !== i).join(" ");
  const room = limit - (rest ? rest.length + 1 : 0);
  const chunks: string[][] = [];
  let cur: string[] = [];
  for (const a of big.alts) {
    const next = [...cur, a];
    if (cur.length && termText({ negate: big.negate, alts: next }).length > room) {
      chunks.push(cur);
      cur = [a];
    } else cur = next;
    if (termText({ negate: big.negate, alts: cur }).length > room)
      return { parts: [], mode: "all", error: "A single alternative plus the other filters is longer than 250 characters." };
  }
  if (cur.length) chunks.push(cur);
  const parts = chunks.map((c) => [rest, termText({ negate: big.negate, alts: c })].filter(Boolean).join(" "));
  // Wanted alternatives: any search may match. Exclusions: an item must pass every search.
  return { parts, mode: big.negate ? "all" : "any", error: null };
}

export const lengthState = (n: number) => (n > LIMIT ? "error" : n > LIMIT - 20 ? "warn" : "ok");
