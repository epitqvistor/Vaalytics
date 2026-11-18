/**
 * Library helpers: export file format, import validation and duplicate
 * handling (merge / skip / replace selected). Imports never replace the
 * whole library.
 */
import type { RegexEntry } from "@/core/ipc/commands";

export const EXPORT_FORMAT = "vaalytics-regex";
export const EXPORT_VERSION = 1;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  game: "poe1";
  exportedAt: string;
  entries: Omit<RegexEntry, "id">[];
}

export function exportJson(entries: readonly RegexEntry[], now = new Date()): string {
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    game: "poe1",
    exportedAt: now.toISOString(),
    entries: entries.map(({ id: _id, ...e }) => e),
  };
  return JSON.stringify(file, null, 2);
}

export interface ImportEntry {
  name: string;
  category: string;
  regex: string;
  description: string;
  tags: string[];
  notes: string;
  favorite: boolean;
}

export interface ImportParse {
  entries: ImportEntry[];
  /** Rows that were rejected, with the reason. */
  rejected: { index: number; reason: string }[];
  error: string | null;
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);

/** Validates an import file. Accepts our export format or a bare array of entries. */
export function parseImport(text: string, game: "poe1" = "poe1"): ImportParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { entries: [], rejected: [], error: "The file is not valid JSON." };
  }
  let list: unknown;
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.format !== EXPORT_FORMAT) return { entries: [], rejected: [], error: "Not a Vaalytics regex export (missing “format”)." };
    if (typeof o.version !== "number" || o.version > EXPORT_VERSION) return { entries: [], rejected: [], error: "This export is from a newer Vaalytics version." };
    if (o.game !== undefined && o.game !== game) return { entries: [], rejected: [], error: `This export is for ${String(o.game)}, not Path of Exile 1.` };
    list = o.entries;
  }
  if (!Array.isArray(list)) return { entries: [], rejected: [], error: "No entries in the file." };

  const entries: ImportEntry[] = [];
  const rejected: ImportParse["rejected"] = [];
  list.forEach((r, index) => {
    if (!r || typeof r !== "object") return rejected.push({ index, reason: "not an object" });
    const o = r as Record<string, unknown>;
    const name = str(o.name, 80)?.trim();
    const category = str(o.category, 80)?.trim();
    const regex = str(o.regex, 4000);
    if (!name) return rejected.push({ index, reason: "missing or too long name" });
    if (!category) return rejected.push({ index, reason: `“${name}”: missing category` });
    if (!regex || !regex.trim()) return rejected.push({ index, reason: `“${name}”: missing regex` });
    const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0 && t.length <= 40).slice(0, 20) : [];
    entries.push({
      name,
      category,
      regex,
      description: str(o.description, 4000) ?? "",
      notes: str(o.notes, 4000) ?? "",
      tags,
      favorite: o.favorite === true,
    });
  });
  // Duplicate names inside the file: keep the first.
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    const k = e.name.toLowerCase();
    if (seen.has(k)) {
      rejected.push({ index: -1, reason: `“${e.name}” appears twice in the file; the first is kept` });
      return false;
    }
    seen.add(k);
    return true;
  });
  return { entries: unique, rejected, error: null };
}

export type DuplicateAction = "merge" | "skip" | "replace";

export interface ImportPlan {
  /** New entries (no name collision). */
  add: ImportEntry[];
  /** Colliding entries the user chose to replace: existing id → imported entry. */
  replace: { existingId: string; entry: ImportEntry }[];
  /** Colliding entries imported under a new name ("name (2)"). */
  renamed: ImportEntry[];
  skipped: ImportEntry[];
}

/**
 * merge = keep both (imported gets a free "(n)" name); skip = keep existing;
 * replace = only the names in `replaceNames` are replaced, others are skipped.
 */
export function planImport(existing: readonly RegexEntry[], incoming: readonly ImportEntry[], action: DuplicateAction, replaceNames: ReadonlySet<string> = new Set()): ImportPlan {
  const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));
  const taken = new Set(existing.map((e) => e.name.toLowerCase()));
  for (const e of incoming) taken.add(e.name.toLowerCase());
  const plan: ImportPlan = { add: [], replace: [], renamed: [], skipped: [] };
  for (const e of incoming) {
    const hit = byName.get(e.name.toLowerCase());
    if (!hit) plan.add.push(e);
    else if (action === "merge") {
      const name = freeName(e.name, taken);
      taken.add(name.toLowerCase());
      plan.renamed.push({ ...e, name });
    } else if (action === "replace" && replaceNames.has(e.name.toLowerCase())) plan.replace.push({ existingId: hit.id, entry: e });
    else plan.skipped.push(e);
  }
  return plan;
}

export function freeName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 2; n < 1000; n++) {
    const base = name.length > 72 ? name.slice(0, 72) : name;
    const c = `${base} (${n})`;
    if (!taken.has(c.toLowerCase())) return c;
  }
  return `${name.slice(0, 60)} ${Date.now()}`;
}

export const newId = () => crypto.randomUUID();

export type SortKey = "updated" | "created" | "name";

export function filterEntries(entries: readonly RegexEntry[], q: { text: string; category: string | null; favorites: boolean; tag: string | null; sort: SortKey }) {
  const t = q.text.trim().toLowerCase();
  const out = entries.filter(
    (e) =>
      (!q.category || e.category === q.category) &&
      (!q.favorites || e.favorite) &&
      (!q.tag || e.tags.some((x) => x.toLowerCase() === q.tag!.toLowerCase())) &&
      (!t || e.name.toLowerCase().includes(t) || e.regex.toLowerCase().includes(t) || e.description.toLowerCase().includes(t) || e.tags.some((x) => x.toLowerCase().includes(t))),
  );
  out.sort((a, b) =>
    q.sort === "name" ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) : q.sort === "created" ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt,
  );
  return out;
}
