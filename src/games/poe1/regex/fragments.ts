/**
 * Shortest-unique-fragment search. Every candidate is checked against the full
 * corpus of lines that can appear on items of the category (mods of all
 * options plus base names and property lines), so a fragment never matches a
 * line of another option. Correctness first: an option with no unique fragment
 * falls back to a longer literal and is reported if even that is shared.
 */
import { escapeRe } from "./syntax";

const MAX_LEN = 16;
/** Rare items carry random two-word names the corpus can't list; 3+ letters keeps accidental hits rare. */
const MIN_LEN = 3;
const MAX_AFTER = 32;

/** Rolled numbers and ranges become "#": "+(80-89) to maximum Life" → "+# to maximum life". */
export const normalizeLine = (line: string) =>
  line
    .toLowerCase()
    .replace(/\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)/g, "#")
    .replace(/\d+(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim();

/** A concrete line for testing number patterns: "#" → 100. */
export const sampleLine = (normalized: string) => normalized.replace(/#/g, "100");

export interface CorpusLine {
  text: string;
  /** Option id the line belongs to; null for lines no option owns (bases, properties). */
  owner: string | null;
}

export interface Fragment {
  /** Escaped regex text (without any number prefix). */
  regex: string;
  cost: number;
  /** The option line it was taken from. */
  line: string;
}

const NONE = "";

export class FragmentIndex {
  /** Normalized corpus lines with their owner ("" = none). */
  readonly lines: { text: string; raw: string; owner: string }[] = [];
  private index = new Map<string, Set<string>>();
  /** Text right after a number ("% increased movement…") → owners. */
  private after = new Map<string, Set<string>>();

  constructor(corpus: readonly CorpusLine[]) {
    const seen = new Set<string>();
    for (const c of corpus) {
      const t = normalizeLine(c.text);
      const owner = c.owner ?? NONE;
      if (!t || seen.has(`${t}\u0000${owner}`)) continue;
      seen.add(`${t}\u0000${owner}`);
      this.lines.push({ text: t, raw: c.text, owner });
      for (let i = 0; i < t.length; i++) {
        for (let len = 2; len <= MAX_LEN && i + len <= t.length; len++) add(this.index, t.slice(i, i + len), owner);
        if (t[i] === "#") for (let len = 1; len <= MAX_AFTER && i + 1 + len <= t.length; len++) add(this.after, t.slice(i + 1, i + 1 + len), owner);
      }
    }
  }

  ownersOf(sub: string): Set<string> | undefined {
    return this.index.get(sub);
  }

  /** Cheapest literal from one of `lines` that appears only in lines of `owner`. */
  fragmentFor(owner: string, lines: readonly string[]): Fragment | null {
    let best: Fragment | null = null;
    for (const raw of lines) {
      const t = normalizeLine(raw);
      for (let i = 0; i < t.length; i++) {
        for (let len = MIN_LEN; len <= MAX_LEN && i + len <= t.length; len++) {
          const sub = t.slice(i, i + len);
          if (sub.includes("#") || sub.startsWith(" ") || sub.endsWith(" ")) continue;
          // "e e", "ve p": short pieces around a space hit random rare names ("Dune Eclipse").
          if (sub.includes(" ") && sub.split(" ").some((w) => w.length < 3)) continue;
          const own = this.index.get(sub);
          if (!own || own.size !== 1 || !own.has(owner)) continue;
          const regex = escapeRe(sub);
          const cost = regex.length + (sub.includes(" ") ? 2 : 0);
          if (!best || cost < best.cost) best = { regex, cost, line: raw };
          break; // longer candidates at this start only cost more
        }
      }
    }
    if (best) return best;
    // Fallback: the whole line (numbers as \d+), anchored when it is part of a longer line.
    for (const raw of lines) {
      const t = normalizeLine(raw);
      const body = escapeRe(t).replace(/#/g, "\\d+");
      for (const regex of [body, `${body}$`, `^${body}$`]) {
        if (this.separates(new RegExp(regex, "i"), owner)) return { regex, cost: regex.length + (t.includes(" ") ? 2 : 0), line: raw };
      }
    }
    return null;
  }

  /**
   * For "value at least N": the text right after the number on one of `lines`
   * that follows a number only on lines of `owner`. The caller prefixes the number pattern.
   */
  afterNumberFor(owner: string, lines: readonly string[]): Fragment | null {
    let best: Fragment | null = null;
    for (const raw of lines) {
      const t = normalizeLine(raw);
      const at = t.indexOf("#");
      if (at < 0) continue;
      const rest = t.slice(at + 1);
      for (let len = 1; len <= MAX_AFTER && len <= rest.length; len++) {
        const sub = rest.slice(0, len);
        if (sub.includes("#")) break;
        if (sub.endsWith(" ")) continue;
        const own = this.after.get(sub);
        if (!own || own.size !== 1 || !own.has(owner)) continue;
        const regex = escapeRe(sub);
        const cost = regex.length + (sub.includes(" ") ? 2 : 0);
        if (!best || cost < best.cost) best = { regex, cost, line: raw };
        break;
      }
    }
    return best;
  }

  /** Owners with at least one line matched by `re` (tested as written and with numbers = 100). */
  ownersMatching(re: RegExp): Set<string> {
    const out = new Set<string>();
    for (const l of this.lines) if (re.test(l.raw) || re.test(sampleLine(l.text))) out.add(l.owner);
    return out;
  }

  /** True when `re` matches some line of `owner` and no line of anyone else. */
  separates(re: RegExp, owner: string): boolean {
    const hit = this.ownersMatching(re);
    return hit.size === 1 && hit.has(owner);
  }
}

function add(map: Map<string, Set<string>>, key: string, owner: string) {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(owner);
}
