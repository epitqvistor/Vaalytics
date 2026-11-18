/**
 * Built-in presets. A preset is a *selection* (resolved against the current
 * data by matching option text), so its string is always generated and
 * checked like any other. Presets whose options are missing from the data say so.
 */
import type { Category, CategoryId } from "./categories";
import { emptyState, type GenState } from "./generator";

export interface Preset {
  id: string;
  category: CategoryId;
  name: string;
  description: string;
  avoid?: RegExp[];
  want?: RegExp[];
  wantMode?: "any" | "all";
  mins?: [RegExp, number][];
  props?: GenState["props"];
}

export const PRESETS: Preset[] = [
  {
    id: "maps-no-regen-reflect",
    category: "maps",
    name: "Avoid build-stoppers",
    description: "Hides maps with no regeneration, thorns reflect, reduced max resistances, less recovery, no leech.",
    avoid: [/cannot regenerate/i, /thorns reflecting/i, /to all maximum resistances/i, /less recovery rate/i, /cannot be leeched/i],
  },
  {
    id: "maps-avoid-curses",
    category: "maps",
    name: "Avoid player curses",
    description: "Hides maps that curse players (Elemental Weakness, Enfeeble, Temporal Chains, Vulnerability).",
    avoid: [/players are cursed with/i],
  },
  {
    id: "maps-t16-quant",
    category: "maps",
    name: "Tier 16, quantity 80%+",
    description: "Tier 16 maps with Item Quantity / Atlas Drops of at least 80%.",
    props: { tierMin: 16, quantity: 80 },
  },
  {
    id: "vendor-links",
    category: "vendor",
    name: "Chromatic, 6 sockets, 5-links",
    description: "Leveling and vendor-recipe pickups: R-G-B, any 6 sockets, any 5-link.",
    want: [/^R, G and B/, /^6 sockets/, /^5\+ linked/],
    wantMode: "any",
  },
  {
    id: "vendor-movespeed",
    category: "vendor",
    name: "Boots with 25%+ movement speed",
    description: "Movement speed of at least 25%.",
    want: [/movement speed/i],
    mins: [[/movement speed/i, 25]],
  },
  {
    id: "flasks-utility",
    category: "flasks",
    name: "Bleed and freeze immunity",
    description: "Flasks granting bleeding or freeze immunity.",
    want: [/immunity to bleeding/i, /immunity to freeze/i],
    wantMode: "any",
  },
];

export interface ResolvedPreset {
  preset: Preset;
  state: GenState;
  /** Patterns that matched no option in the current data. */
  missing: string[];
}

export function resolvePreset(cat: Category, p: Preset): ResolvedPreset {
  const st = emptyState();
  const missing: string[] = [];
  const pick = (patterns: RegExp[] | undefined, into: string[]) => {
    for (const re of patterns ?? []) {
      const hits = cat.options.filter((o) => re.test(o.label));
      if (!hits.length) missing.push(re.source);
      for (const h of hits) if (!into.includes(h.id)) into.push(h.id);
    }
  };
  pick(p.avoid, st.avoid);
  pick(p.want, st.want);
  st.wantMode = p.wantMode ?? "any";
  for (const [re, n] of p.mins ?? []) for (const o of cat.options) if (re.test(o.label) && st.want.includes(o.id)) st.mins[o.id] = n;
  st.props = { ...(p.props ?? {}) };
  return { preset: p, state: st, missing };
}
