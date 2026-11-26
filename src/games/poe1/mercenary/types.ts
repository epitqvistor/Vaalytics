import type { SkillCategory } from "./catalog";

/**
 * confirmed — read exactly and consistent with the catalog (or corrected by you)
 * inferred  — derived (e.g. family from the skills when the Build line is missing)
 * ambiguous — readable but more than one meaning, or not consistent with the catalog
 * unknown   — not readable / not in the catalog
 */
export type FieldStatus = "confirmed" | "inferred" | "ambiguous" | "unknown";

export interface Field<T> {
  value: T | null;
  status: FieldStatus;
  note?: string;
  /** Candidate values when ambiguous. */
  options?: T[];
  /** Set when the value comes from the user's correction. */
  corrected?: boolean;
}

export interface ParsedSupport {
  /** Line as copied. */
  raw: string;
  /** Support name as copied (without the tier). */
  name: string;
  support: Field<string>;
  tier: Field<number>;
  /** Official stat id for this support tier on its owning skill. */
  stat: string | null;
}

export interface ParsedSkill {
  raw: string;
  name: string;
  skill: Field<string>;
  category: SkillCategory | null;
  stat: string | null;
  /** Supports bound to this skill, in the order shown. Never merged across skills. */
  supports: ParsedSupport[];
}

export interface ParsedWarrant {
  source: "clipboard" | "trade-listing";
  mercName: string | null;
  /** Catalog variant id, e.g. "kineticist" or "kineticist.infamous". */
  variant: Field<string>;
  family: Field<string>;
  infamous: Field<boolean>;
  /** Mercenary level (never Area Level / Item Tier). */
  level: Field<number>;
  warrantType: string | null;
  skills: ParsedSkill[];
  /** Metadata lines recognised and deliberately not used (Area Level, Item Tier, Limit, Portal, Note…). */
  ignored: string[];
  /** Lines not understood. */
  unparsed: string[];
  problems: string[];
}

export interface WarrantCorrections {
  variant?: string;
  level?: number;
  skills?: Record<number, { skill?: string; supports?: Record<number, { support: string; tier: number } | null> }>;
}
