/**
 * Dataset validator: referential integrity, acyclic dependencies, provenance
 * rules. Run by the tests for every shipped dataset; a broken dataset never
 * reaches the engine.
 */
import type { CampaignDataset, Provenance } from "./types";

export interface ValidationIssue {
  id: string;
  problem: string;
}

export function validateDataset(d: CampaignDataset): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (id: string, problem: string) => issues.push({ id, problem });

  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) add(id, `duplicate ${kind} id`);
      seen.add(id);
    }
    return seen;
  };
  const parts = dup("part", d.parts.map((p) => p.id));
  const zones = dup("zone", d.zones.map((z) => z.id));
  const objectives = dup("objective", d.objectives.map((o) => o.id));
  const rewards = dup("reward", d.rewards.map((r) => r.id));
  const items = dup("item", d.items.map((i) => i.id));
  const sources = new Set(d.sources.map((s) => s.id));

  const areaOwners = new Map<string, string>();
  for (const z of d.zones) {
    if (!parts.has(z.part)) add(z.id, `unknown part ${z.part}`);
    for (const c of z.connects) if (!zones.has(c)) add(z.id, `connects to unknown zone ${c}`);
    for (const o of z.opensAfter ?? []) if (!objectives.has(o)) add(z.id, `opensAfter unknown objective ${o}`);
    for (const a of z.areaIds) {
      const owner = areaOwners.get(a);
      if (owner) add(z.id, `area id ${a} already belongs to ${owner}`);
      areaOwners.set(a, z.id);
    }
    if (z.areaIds.length === 0 && z.provenance.verification === "confirmed" && !z.provenance.note) {
      add(z.id, "zone without a logged area id must explain why (note)");
    }
    checkProvenance(z.id, z.provenance);
  }
  for (const p of d.parts) {
    if (!zones.has(p.town)) add(p.id, `unknown town ${p.town}`);
    for (const o of p.opensAfter) if (!objectives.has(o)) add(p.id, `opensAfter unknown objective ${o}`);
  }

  const zoneById = new Map(d.zones.map((z) => [z.id, z]));
  for (const o of d.objectives) {
    if (!parts.has(o.part)) add(o.id, `unknown part ${o.part}`);
    if (!zones.has(o.zone)) add(o.id, `unknown zone ${o.zone}`);
    if (o.turnIn && !zones.has(o.turnIn)) add(o.id, `unknown turn-in zone ${o.turnIn}`);
    for (const r of [...o.requires, ...(o.recommendedAfter ?? [])]) if (!objectives.has(r)) add(o.id, `depends on unknown objective ${r}`);
    for (const r of o.rewards) if (!rewards.has(r)) add(o.id, `unknown reward ${r}`);
    for (const i of [...(o.needsItems ?? []), ...(o.givesItems ?? [])]) if (!items.has(i)) add(o.id, `unknown item ${i}`);
    if (o.steps.length === 0) add(o.id, "objective without steps");
    // The engine infers requirements of finished objectives; a main objective
    // depending on an optional one would make skipped content look done.
    if (o.kind === "main") {
      for (const r of o.requires) if (d.objectives.find((x) => x.id === r)?.kind === "optional") add(o.id, `main objective requires optional ${r}`);
    }
    if (o.detection?.kind === "passive-points") {
      for (const z of o.detection.zones) if (!zones.has(z)) add(o.id, `detection zone ${z} unknown`);
      for (const z of o.detection.zones) if (zoneById.get(z)?.areaIds.length === 0) add(o.id, `detection zone ${z} has no logged area id`);
    }
    checkProvenance(o.id, o.provenance);
  }
  for (const r of d.rewards) {
    const o = d.objectives.find((x) => x.id === r.objective);
    if (!o) add(r.id, `unknown objective ${r.objective}`);
    else if (!o.rewards.includes(r.id)) add(r.id, `objective ${o.id} doesn't list this reward`);
    if (r.category === "choice" && !(r.choices && r.choices.length >= 2)) add(r.id, "choice reward needs ≥ 2 options");
    checkProvenance(r.id, r.provenance);
  }
  for (const i of d.items) {
    if (!objectives.has(i.from)) add(i.id, `unknown source objective ${i.from}`);
    if (!objectives.has(i.usedBy)) add(i.id, `unknown consuming objective ${i.usedBy}`);
    checkProvenance(i.id, i.provenance);
  }

  for (const cycle of findCycles(d)) add(cycle[0] ?? "?", `dependency cycle: ${cycle.join(" → ")}`);
  return issues;

  function checkProvenance(id: string, p: Provenance) {
    for (const s of p.sources) if (!sources.has(s)) add(id, `unknown source ${s}`);
    if (p.verification === "confirmed" && p.sources.length < 2) add(id, "confirmed needs ≥ 2 sources (guide + guide, or guide + log)");
    if (p.verification === "conflict" && !(p.conflicts && p.conflicts.length > 0)) add(id, "conflict without recorded conflicting claims");
    if (p.sources.length === 0) add(id, "no source");
  }
}

/** Cycles over hard requirements + part gates (zone gates included). */
function findCycles(d: CampaignDataset): string[][] {
  const partOf = new Map(d.objectives.map((o) => [o.id, o.part]));
  const partGate = new Map(d.parts.map((p) => [p.id, p.opensAfter]));
  const edges = new Map<string, string[]>();
  for (const o of d.objectives) {
    const deps = [...o.requires, ...(partGate.get(o.part) ?? [])].filter((x) => partOf.has(x));
    edges.set(o.id, deps);
  }
  const cycles: string[][] = [];
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    stack.push(id);
    for (const dep of edges.get(id) ?? []) {
      if (state.get(dep) === 1) cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
      else if (!state.has(dep)) visit(dep);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of edges.keys()) if (!state.has(id)) visit(id);
  return cycles;
}
