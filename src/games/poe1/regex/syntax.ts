/**
 * Path of Exile 1 in-game search syntax (stash, vendor, inventory search box),
 * English client.
 *
 * - The query is split into terms by spaces; every term must match (AND).
 * - A term in double quotes may contain spaces.
 * - A term starting with `!` must NOT match (exclusion).
 * - Inside a term: case-insensitive regular expression; `|` = OR, `.*`, `[0-9]`,
 *   `\d`, `( )`, `{n}`, `^`/`$` (line anchors).
 * - Each term is tested against the item's text lines.
 * - The search box accepts 250 characters.
 * Spec: docs/modules/regex.md
 */

export const LIMIT = 250;

export type Term = {
  /** Excluded: the item must not match. */
  negate?: boolean;
  /** Regex alternatives (already escaped); joined with `|`. */
  alts: string[];
};

const SPECIAL = /[.*+?^${}()|[\]\\]/g;
export const escapeRe = (s: string) => s.replace(SPECIAL, "\\$&");

/** Quoting is needed for spaces; `!` goes inside the quotes. */
export function termText(t: Term): string {
  const body = [...new Set(t.alts)].join("|");
  const s = (t.negate ? "!" : "") + body;
  return /\s/.test(s) ? `"${s}"` : s;
}

export const build = (terms: readonly Term[]) =>
  terms
    .filter((t) => t.alts.length > 0)
    .map(termText)
    .join(" ");

/** Splits a query into terms (respecting quotes), each into top-level `|` alternatives. */
export function parseQuery(q: string): Term[] {
  const out: Term[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m = re.exec(q); m; m = re.exec(q)) {
    let body = m[1] ?? m[2] ?? "";
    let negate = false;
    if (body.startsWith("!")) {
      negate = true;
      body = body.slice(1);
    }
    if (body) out.push({ negate, alts: splitTopLevel(body) });
  }
  return out;
}

/** `a|(b|c)|d` → ["a", "(b|c)", "d"] */
export function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inClass = false;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === "\\" && i + 1 < body.length) {
      cur += c + body[++i];
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") inClass = true;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "|" && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.filter((p) => p.length > 0);
}

/** A regex body the game would also accept (we compile it the same way: case-insensitive). */
export function compile(body: string): RegExp | null {
  try {
    return new RegExp(body, "i");
  } catch {
    return null;
  }
}

export interface TermResult {
  term: Term;
  text: string;
  /** Lines of the item this term matched. */
  matchedLines: string[];
  ok: boolean;
  invalid: boolean;
}

/** Evaluates a query against an item's text lines exactly like the search box would. */
export function evaluate(query: string, lines: readonly string[]): { ok: boolean; terms: TermResult[] } {
  const terms = parseQuery(query).map((term) => {
    const text = termText(term);
    const re = compile(term.alts.join("|"));
    if (!re) return { term, text, matchedLines: [], ok: false, invalid: true };
    const matchedLines = lines.filter((l) => re.test(l));
    return { term, text, matchedLines, ok: term.negate ? matchedLines.length === 0 : matchedLines.length > 0, invalid: false };
  });
  return { ok: terms.length > 0 && terms.every((t) => t.ok), terms };
}

/** Item text as the search sees it: one entry per non-separator line. */
export const itemLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^-+$/.test(l));

// ---------- numbers ----------

/**
 * Regex for whole numbers ≥ n (n ≤ 999). Matching inside a larger number is
 * safe: any digit run that matches is itself ≥ n, and a longer number around it is larger.
 * Decimals aren't handled ("1.5%" contains "5%").
 */
export function atLeast(n: number): string {
  n = Math.max(0, Math.ceil(n));
  if (n <= 0) return "\\d";
  const s = String(n);
  const len = s.length;
  const alts: string[] = [];
  // Same length, digit by digit.
  for (let i = 0; i < len; i++) {
    const d = Number(s[i]);
    const prefix = s.slice(0, i);
    const restLen = len - i - 1;
    const isLast = i === len - 1;
    const from = isLast ? d : d + 1;
    if (from <= 9) alts.push(prefix + digitRange(from, 9) + (restLen ? (restLen === 1 ? "\\d" : `\\d{${restLen}}`) : ""));
  }
  // Longer numbers are always larger. Leading zeros don't occur.
  alts.push(len === 1 ? "[1-9]\\d+" : `[1-9]\\d{${len},}`);
  const uniq = [...new Set(alts)];
  return uniq.length === 1 ? uniq[0]! : `(${uniq.join("|")})`;
}

const digitRange = (a: number, b: number) => (a === b ? String(a) : a === 0 && b === 9 ? "\\d" : `[${a}-${b}]`);

/** Exact range [a, b] for small values (tiers, levels): explicit alternation. */
export function between(a: number, b: number): string {
  const vals: string[] = [];
  for (let v = Math.max(0, a); v <= b; v++) vals.push(String(v));
  return vals.length === 1 ? vals[0]! : `(${vals.join("|")})`;
}
