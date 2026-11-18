import { describe, expect, it } from "vitest";
import fixture from "../crafting/fixtures/poe1-subset.json";
import type { CraftingData } from "../crafting/types";
import search from "./fixtures/search-3.30.json";
import { buildCategories, type Category, type CategoryId, type SearchData } from "./categories";
import { normalizeLine, sampleLine } from "./fragments";
import { emptyState, falsePositives, generate, pieceFor, splitQuery, type GenState } from "./generator";
import { exportJson, parseImport, planImport } from "./library";
import { PRESETS, resolvePreset } from "./presets";
import { reverseLookup, stateFromLookup } from "./reverse";
import { atLeast, between, build, compile, evaluate, itemLines, LIMIT, parseQuery, splitTopLevel, termText } from "./syntax";

const data = { ...(fixture as unknown as CraftingData), search: search as unknown as SearchData };
const cats = buildCategories(data);
const cat = (id: CategoryId) => cats.find((c) => c.id === id)!;
const st = (p: Partial<GenState>): GenState => ({ ...emptyState(), ...p });
const opt = (c: Category, re: RegExp) => {
  const o = c.options.find((x) => re.test(x.label));
  if (!o) throw new Error(`no option ${re}`);
  return o;
};

const MAP_A = `Item Class: Maps
Rarity: Rare
Grim Haven
Strand Map
--------
Map Tier: 16
Item Quantity: +87% (augmented)
Item Rarity: +45% (augmented)
Monster Pack Size: +28% (augmented)
Quality: +20% (augmented)
--------
Item Level: 83
--------
Monster Level: 83
--------
Rare Monsters have Physical Thorns reflecting 200 Physical Damage
Players cannot Regenerate Life, Mana or Energy Shield
Monsters deal 102% extra Physical Damage as Fire
Monsters have 40% increased Area of Effect
--------
Travel to this Map by using it in a personal Map Device. Maps can only be used once.
--------
Corrupted`;

const MAP_B = `Item Class: Maps
Rarity: Magic
Hexproof Strand Map of Exposure
--------
Map Tier: 14
Atlas Drops: +40% (augmented)
--------
Item Level: 81
--------
Monsters are Hexproof
Players have -12% to all maximum Resistances
--------
Travel to this Map by using it in a personal Map Device. Maps can only be used once.`;

describe("search syntax", () => {
  it("quotes terms with spaces, keeps ! inside the quotes, joins terms with spaces", () => {
    expect(termText({ alts: ["abc", "def"] })).toBe("abc|def");
    expect(termText({ negate: true, alts: ["cannot reg", "reflect"] })).toBe('"!cannot reg|reflect"');
    expect(build([{ alts: ["a b"] }, { negate: true, alts: ["x"] }, { alts: [] }])).toBe('"a b" !x');
  });

  it("parses queries back into terms, respecting quotes, groups and classes", () => {
    const q = '"!cannot reg|refl" tier: (14|15) "a|[b|c]|(d|e)"';
    const t = parseQuery(q);
    expect(t.map((x) => [x.negate, x.alts])).toEqual([
      [true, ["cannot reg", "refl"]],
      [false, ["tier:"]],
      [false, ["(14|15)"]],
      [false, ["a", "[b|c]", "(d|e)"]],
    ]);
    expect(splitTopLevel("a\\|b|c")).toEqual(["a\\|b", "c"]);
  });

  it("evaluates like the search box: AND of terms, exclusions, per line, case-insensitive", () => {
    const lines = itemLines(MAP_A);
    expect(lines).not.toContain("--------");
    expect(evaluate("thorns", lines).ok).toBe(true);
    expect(evaluate("!thorns", lines).ok).toBe(false);
    expect(evaluate('"physical thorns" corrupted', lines).ok).toBe(true);
    expect(evaluate('"physical thorns" !corrupted', lines).ok).toBe(false);
    // A term must match within one line, not across lines.
    expect(evaluate('"energy shield.*monsters deal"', lines).ok).toBe(false);
    expect(evaluate("(", lines).terms[0]!.invalid).toBe(true);
  });

  it("atLeast(n) matches exactly the whole numbers ≥ n (also inside larger numbers)", () => {
    for (let n = 0; n <= 260; n++) {
      const re = new RegExp(atLeast(n) + "% inc");
      for (let v = 0; v <= 1000; v++) expect(re.test(`${v}% increased`), `n=${n} v=${v}`).toBe(v >= n);
    }
    for (const n of [299, 450, 999]) {
      const re = new RegExp(atLeast(n) + "%");
      for (let v = 0; v <= 1000; v++) expect(re.test(`+${v}%`), `n=${n} v=${v}`).toBe(v >= n);
    }
  });

  it("between(a, b) with a line anchor matches only that range", () => {
    const re = new RegExp(`tier: ${between(1, 3)}$`, "i");
    expect([1, 2, 3, 4, 11, 13, 16].map((v) => re.test(`Map Tier: ${v}`))).toEqual([true, true, true, false, false, false, false]);
  });
});

describe("categories from 3.30 data", () => {
  it("offers every generator with data, Threads instead of Scarabs", () => {
    expect(cats.map((c) => c.id)).toEqual(["maps", "vendor", "items", "flasks", "jewels", "expedition", "heist", "tattoos", "threads"]);
    const threads = cat("threads").options.map((o) => o.label);
    expect(threads).toContain("Abyss Thread");
    expect(threads.some((t) => /scarab/i.test(t))).toBe(false);
  });

  it("hides the reward lines map mods carry and keeps the visible mod lines", () => {
    const labels = cat("maps").options.map((o) => o.label);
    expect(labels.some((l) => /Atlas Drops|Rarity of Items found|Pack size/.test(l))).toBe(false);
    expect(labels).toContain("Players cannot Regenerate Life, Mana or Energy Shield");
  });

  // The optimisation corpus: every option of every category must get a
  // fragment that matches its own lines and no other line of the corpus.
  for (const id of ["maps", "expedition", "heist", "flasks", "tattoos", "threads", "jewels", "items"] as CategoryId[]) {
    it(`${id}: every option gets a unique piece with no false positives or negatives`, () => {
      const c = cat(id);
      const ambiguous: string[] = [];
      for (const o of c.options) {
        const { regex } = pieceFor(c, o);
        if (!regex) {
          ambiguous.push(o.label);
          continue;
        }
        const re = compile(regex)!;
        expect(
          o.lines.some((l) => re.test(sampleLine(normalizeLine(l)))),
          `${o.label} ← ${regex}`,
        ).toBe(true);
        expect(falsePositives(c, regex, o.id), `${o.label} ← ${regex}`).toEqual([]);
        // No tiny word pieces around spaces (they hit random rare item names).
        if (regex.length <= 16 && !regex.includes("\\d") && !regex.endsWith("$")) for (const w of regex.split(" ")) expect(w.length, `${o.label} ← ${regex}`).toBeGreaterThanOrEqual(3);
      }
      // Ambiguous = the line is inside a longer line, or identical to a base/crafted line: a search can't separate them.
      for (const label of ambiguous) {
        const norm = normalizeLine(label);
        expect(
          c.index.lines.some((l) => (l.text !== norm && l.text.includes(norm)) || (l.text === norm && l.owner === "")),
          `ambiguous without a containing line: ${label}`,
        ).toBe(true);
      }
      expect(ambiguous.length / c.options.length).toBeLessThan(0.05);
    });
  }

  it("vendor patterns: links and sockets", () => {
    const v = cat("vendor");
    const q = (re: RegExp) => termText({ alts: [pieceFor(v, opt(v, re)).regex!] });
    const sockets = (s: string) => [`Sockets: ${s}`];
    expect(evaluate(q(/^4\+ linked/), sockets("R-G-B-B R")).ok).toBe(true);
    expect(evaluate(q(/^4\+ linked/), sockets("R-G-B B-R")).ok).toBe(false);
    expect(evaluate(q(/^6 sockets/), sockets("R G B-B R-G")).ok).toBe(true);
    expect(evaluate(q(/^6 sockets/), sockets("R G B-B R")).ok).toBe(false);
    expect(evaluate(q(/^R, G and B/), sockets("B-R-G W")).ok).toBe(true);
    expect(evaluate(q(/^R, G and B/), sockets("B-R G")).ok).toBe(false);
    // Link patterns don't hit hyphenated words of bases or mods.
    // (Overlaps between socket options are intended: a 6-link is also a 4+ link.)
    for (const o of v.options) expect(falsePositives(v, o.fixed!, o.id).filter((x) => x === ""), o.label).toEqual([]);
    const ms = pieceFor(v, opt(v, /Movement Speed/), 25).regex!;
    expect(evaluate(`"${ms}"`, ["30% increased Movement Speed"]).ok).toBe(true);
    expect(evaluate(`"${ms}"`, ["20% increased Movement Speed"]).ok).toBe(false);
  });
});

describe("generator on real map text", () => {
  const maps = cat("maps");
  const regen = opt(maps, /cannot Regenerate/);
  const thorns = opt(maps, /Physical Thorns/);
  const hexproof = opt(maps, /are Hexproof/);
  const maxres = opt(maps, /to all maximum Resistances/);

  it("exclusions hide the right maps", () => {
    const g = generate(maps, st({ avoid: [regen.id, thorns.id] }));
    expect(g.query.startsWith('"!') || g.query.startsWith("!")).toBe(true);
    expect(evaluate(g.query, itemLines(MAP_A)).ok).toBe(false);
    expect(evaluate(g.query, itemLines(MAP_B)).ok).toBe(true);
    expect(g.issues.filter((i) => i.kind !== "unverified")).toEqual([]);
  });

  it("wanted mods: any vs all", () => {
    const any = generate(maps, st({ want: [hexproof.id, regen.id], wantMode: "any" }));
    expect(evaluate(any.query, itemLines(MAP_A)).ok).toBe(true);
    expect(evaluate(any.query, itemLines(MAP_B)).ok).toBe(true);
    const all = generate(maps, st({ want: [hexproof.id, maxres.id], wantMode: "all" }));
    expect(evaluate(all.query, itemLines(MAP_A)).ok).toBe(false);
    expect(evaluate(all.query, itemLines(MAP_B)).ok).toBe(true);
  });

  it("properties: tier range, quantity (both spellings), rarity, pack size, corrupted", () => {
    const run = (props: GenState["props"], text: string) => evaluate(generate(maps, st({ props })).query, itemLines(text)).ok;
    expect(run({ tierMin: 15 }, MAP_A)).toBe(true);
    expect(run({ tierMin: 15 }, MAP_B)).toBe(false);
    expect(run({ tierMin: 14, tierMax: 14 }, MAP_B)).toBe(true);
    expect(run({ tierMax: 15 }, MAP_A)).toBe(false);
    expect(run({ quantity: 80 }, MAP_A)).toBe(true);
    expect(run({ quantity: 90 }, MAP_A)).toBe(false);
    expect(run({ quantity: 40 }, MAP_B)).toBe(true, /* Atlas Drops spelling */);
    expect(run({ quantity: 41 }, MAP_B)).toBe(false);
    expect(run({ rarity: 45 }, MAP_A)).toBe(true);
    expect(run({ rarity: 46 }, MAP_A)).toBe(false);
    expect(run({ packSize: 25 }, MAP_A)).toBe(true);
    expect(run({ packSize: 25 }, MAP_B)).toBe(false);
    expect(run({ corrupted: "no" }, MAP_A)).toBe(false);
    expect(run({ corrupted: "no" }, MAP_B)).toBe(true);
    expect(run({ corrupted: "yes" }, MAP_A)).toBe(true);
    expect(generate(maps, st({ props: { quantity: 80 } })).issues.some((i) => i.kind === "unverified")).toBe(true);
  });

  it("property patterns don't hit mod lines", () => {
    for (const p of maps.props) {
      const t = p.term(p.kind === "tri" ? "yes" : 10, {});
      if (!t) continue;
      expect(falsePositives(maps, t.alts.join("|"), "").filter(Boolean), p.id).toEqual([]);
    }
  });
});

describe("250-character limit", () => {
  const maps = cat("maps");
  const all = generate(maps, st({ avoid: maps.options.map((o) => o.id) }));

  it("never truncates: long exclusions are split, every alternative kept", () => {
    expect(all.query.length).toBeGreaterThan(LIMIT);
    const r = splitQuery(all.query);
    expect(r.error).toBeNull();
    expect(r.mode).toBe("all");
    expect(r.parts.length).toBeGreaterThan(1);
    for (const p of r.parts) expect(p.length).toBeLessThanOrEqual(LIMIT);
    const original = parseQuery(all.query)[0]!.alts;
    const parts = r.parts.flatMap((p) => parseQuery(p)[0]!.alts);
    expect(parts.sort()).toEqual([...original].sort());
  });

  it("wanted alternatives split into searches where any may match; other terms repeated", () => {
    const g = generate(maps, st({ want: maps.options.map((o) => o.id), props: { tierMin: 16 } }));
    const r = splitQuery(g.query);
    expect(r.mode).toBe("any");
    for (const p of r.parts) {
      expect(p.length).toBeLessThanOrEqual(LIMIT);
      expect(p).toContain("tier: (16|17)$");
    }
  });

  it("refuses to split two overlong terms instead of changing meaning", () => {
    const g = generate(maps, st({ want: maps.options.map((o) => o.id), avoid: maps.options.map((o) => o.id) }));
    const r = splitQuery(g.query);
    expect(r.parts).toEqual([]);
    expect(r.error).toMatch(/can't be split/);
  });

  it("short strings stay single", () => {
    expect(splitQuery("abc")).toEqual({ parts: ["abc"], mode: "single", error: null });
  });
});

describe("reverse lookup", () => {
  const maps = cat("maps");
  it("round-trips a generated string and keeps unknown fragments", () => {
    const regen = opt(maps, /cannot Regenerate/);
    const hex = opt(maps, /are Hexproof/);
    const g = generate(maps, st({ avoid: [regen.id], want: [hex.id] }));
    const q = `${g.query} "!xyzzy" "tier: 16$"`;
    const info = reverseLookup(maps, q);
    const flat = info.flatMap((t) => t.alts);
    expect(flat.find((a) => a.alt === "xyzzy")?.status).toBe("unknown");
    expect(flat.find((a) => a.alt.startsWith("tier"))?.status).toBe("property");
    const back = stateFromLookup(info);
    expect(back.avoid).toEqual([regen.id]);
    expect(back.want).toEqual([hex.id]);
    expect(back.extra).toEqual(["!xyzzy", '"tier: 16$"']);
    // Regenerating keeps the meaning, including the unknown parts.
    const again = generate(maps, back).query;
    for (const text of [MAP_A, MAP_B]) expect(evaluate(again, itemLines(text)).ok).toBe(evaluate(q, itemLines(text)).ok);
  });

  it("keeps minimum-value alternatives verbatim", () => {
    const v = cat("vendor");
    const g = generate(v, st({ want: [opt(v, /Movement/).id], mins: { [opt(v, /Movement/).id]: 25 } }));
    const back = stateFromLookup(reverseLookup(v, g.query));
    expect(back.want).toEqual([]);
    expect(generate(v, back).query).toBe(g.query);
  });
});

describe("presets", () => {
  it("resolve against 3.30 data with nothing missing", () => {
    for (const p of PRESETS) {
      const r = resolvePreset(cat(p.category), p);
      expect(r.missing, p.id).toEqual([]);
      const g = generate(cat(p.category), r.state);
      expect(g.query.length, p.id).toBeGreaterThan(0);
      expect(g.issues.filter((i) => i.kind === "ambiguous" || i.kind === "invalid"), p.id).toEqual([]);
    }
  });

  it("build-stopper preset hides map A", () => {
    const maps = cat("maps");
    const r = resolvePreset(maps, PRESETS.find((p) => p.id === "maps-no-regen-reflect")!);
    expect(evaluate(generate(maps, r.state).query, itemLines(MAP_A)).ok).toBe(false);
  });
});

describe("library import / export", () => {
  const existing = [
    { id: "1", name: "Safe maps", category: "Maps", regex: "!x", description: "", tags: [], notes: "", favorite: false, createdAt: 1, updatedAt: 1 },
    { id: "2", name: "Chromatic", category: "Vendor", regex: "r-g-b", description: "", tags: ["lev"], notes: "", favorite: true, createdAt: 2, updatedAt: 2 },
  ];

  it("exports and re-imports", () => {
    const text = exportJson(existing, new Date(0));
    const parsed = parseImport(text);
    expect(parsed.error).toBeNull();
    expect(parsed.entries.map((e) => [e.name, e.regex, e.favorite, e.tags])).toEqual([
      ["Safe maps", "!x", false, []],
      ["Chromatic", "r-g-b", true, ["lev"]],
    ]);
  });

  it("validates", () => {
    expect(parseImport("{").error).toMatch(/not valid JSON/);
    expect(parseImport('{"format":"other"}').error).toMatch(/Not a Vaalytics/);
    expect(parseImport('{"format":"vaalytics-regex","version":99,"entries":[]}').error).toMatch(/newer/);
    expect(parseImport('{"format":"vaalytics-regex","version":1,"game":"poe2","entries":[]}').error).toMatch(/not Path of Exile 1/);
    const r = parseImport(
      JSON.stringify([{ name: "a", category: "Maps", regex: "x" }, { name: "", category: "Maps", regex: "x" }, { name: "b", category: "Maps" }, { name: "A", category: "Maps", regex: "y" }, 5]),
    );
    expect(r.entries.map((e) => e.name)).toEqual(["a"]);
    expect(r.rejected).toHaveLength(4);
  });

  it("merge / skip / replace selected — never replaces everything", () => {
    const incoming = [
      { name: "safe maps", category: "Maps", regex: "!y", description: "", tags: [], notes: "", favorite: false },
      { name: "Chromatic", category: "Vendor", regex: "b-g-r", description: "", tags: [], notes: "", favorite: false },
      { name: "New", category: "Custom", regex: "z", description: "", tags: [], notes: "", favorite: false },
    ];
    const merge = planImport(existing, incoming, "merge");
    expect(merge.add.map((e) => e.name)).toEqual(["New"]);
    expect(merge.renamed.map((e) => e.name)).toEqual(["safe maps (2)", "Chromatic (2)"]);
    const skip = planImport(existing, incoming, "skip");
    expect(skip.skipped).toHaveLength(2);
    expect(skip.replace).toHaveLength(0);
    const rep = planImport(existing, incoming, "replace", new Set(["chromatic"]));
    expect(rep.replace).toEqual([{ existingId: "2", entry: incoming[1] }]);
    expect(rep.skipped.map((e) => e.name)).toEqual(["safe maps"]);
  });
});
