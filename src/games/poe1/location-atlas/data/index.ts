/**
 * Lazy loader for the PoE 1 Location Atlas dataset. Acts are separate JSON chunks, loaded on first use and
 * cached for the app run; a malformed act is reported, never thrown at the UI.
 */
import meta from "./3.30/meta.json";
import type { ActData, AtlasDataset, AtlasMeta } from "./types";
import { validateAct, validateDataset, type ValidationIssue } from "./validate";

export const ATLAS_META = meta as AtlasMeta;
const ACT_LOADERS = import.meta.glob<{ default: unknown }>("./3.30/act-*.json");

const actCache = new Map<number, Promise<{ act: ActData | null; issues: ValidationIssue[] }>>();

const actPath = (n: number) => `./3.30/act-${String(n).padStart(2, "0")}.json`;

/** One act, validated; `act` is null when its file is missing or invalid. */
export function loadAct(n: number): Promise<{ act: ActData | null; issues: ValidationIssue[] }> {
  let p = actCache.get(n);
  if (!p) {
    const load = ACT_LOADERS[actPath(n)];
    p = load
      ? load()
          .then((m) => {
            const issues = validateAct(m.default);
            return { act: issues.some((i) => i.severity === "error") ? null : (m.default as ActData), issues };
          })
          .catch((e) => ({ act: null, issues: [{ severity: "error" as const, where: `act ${n}`, message: String(e) }] }))
      : Promise.resolve({ act: null, issues: [{ severity: "error" as const, where: `act ${n}`, message: "no data file" }] });
    actCache.set(n, p);
  }
  return p;
}

/** All acts (for the act map and cross-act routes) plus whole-dataset validation. */
export async function loadDataset(): Promise<{ dataset: AtlasDataset; issues: ValidationIssue[] }> {
  const loaded = await Promise.all(ATLAS_META.acts.map(loadAct));
  const acts = loaded.flatMap((l) => (l.act ? [l.act] : []));
  const dataset: AtlasDataset = { meta: ATLAS_META, acts };
  const issues = [...loaded.flatMap((l) => l.issues), ...(acts.length === ATLAS_META.acts.length ? validateDataset(dataset) : [])];
  return { dataset, issues };
}
