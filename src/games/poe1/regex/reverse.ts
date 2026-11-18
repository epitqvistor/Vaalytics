/**
 * Reverse lookup: explains an existing search string with the category's
 * options. Fragments no option explains are kept verbatim and marked unknown.
 */
import type { Category } from "./categories";
import type { GenState } from "./generator";
import { compile, parseQuery, termText, type Term } from "./syntax";

export type AltStatus = "option" | "ambiguous" | "property" | "unknown" | "invalid";

export interface AltInfo {
  alt: string;
  status: AltStatus;
  /** Matched option ids (one for "option", several for "ambiguous"). */
  options: string[];
}

export interface TermInfo {
  term: Term;
  text: string;
  alts: AltInfo[];
}

export function reverseLookup(cat: Category, query: string): TermInfo[] {
  return parseQuery(query).map((term) => ({
    term,
    text: termText(term),
    alts: term.alts.map((alt): AltInfo => {
      const re = compile(alt);
      if (!re) return { alt, status: "invalid", options: [] };
      const owners = cat.index.ownersMatching(re);
      const options = [...owners].filter(Boolean);
      if (options.length === 1) return { alt, status: "option", options };
      if (options.length > 1) return { alt, status: "ambiguous", options };
      if (owners.has("")) return { alt, status: "property", options: [] };
      // Fixed (vendor) options aren't text matches; compare the pattern itself.
      const fixed = cat.options.find((o) => o.fixed && (o.fixed === alt || o.fixedMin?.(0) === alt));
      if (fixed) return { alt, status: "option", options: [fixed.id] };
      return { alt, status: "unknown", options: [] };
    }),
  }));
}

/**
 * Loads a looked-up string into the generator. Single-option alternatives
 * become selections; everything else (properties, ambiguous, unknown) is kept
 * as verbatim terms so nothing is lost.
 */
export function stateFromLookup(info: TermInfo[]): GenState {
  const st: GenState = { want: [], wantMode: "any", avoid: [], mins: {}, props: {}, extra: [] };
  // Alternatives with number patterns carry a minimum the selection can't hold: keep them verbatim.
  const loadable = (a: AltInfo) => a.status === "option" && !/\\d|\[\d/.test(a.alt);
  const positive = info.filter((t) => !t.term.negate);
  const allSingles = positive.length > 1 && positive.every((t) => t.alts.length === 1 && loadable(t.alts[0]!));
  let anyTermUsed = false;
  for (const t of info) {
    if (t.term.negate) {
      for (const a of t.alts.filter(loadable)) if (!st.avoid.includes(a.options[0]!)) st.avoid.push(a.options[0]!);
      const rest = t.alts.filter((a) => !loadable(a));
      if (rest.length) st.extra.push(termText({ negate: true, alts: rest.map((a) => a.alt) }));
    } else if (allSingles) {
      st.wantMode = "all";
      st.want.push(t.alts[0]!.options[0]!);
    } else if (!anyTermUsed && t.alts.every(loadable)) {
      anyTermUsed = true;
      for (const a of t.alts) if (!st.want.includes(a.options[0]!)) st.want.push(a.options[0]!);
    } else st.extra.push(t.text);
  }
  return st;
}
