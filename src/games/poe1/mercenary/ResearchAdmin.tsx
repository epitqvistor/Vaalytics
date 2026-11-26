/**
 * Research admin: the catalog (families, pools, supports per skill), the rules with their
 * evidence, confidence and review dates, sample thresholds, and controlled with/without
 * comparisons that stage rule candidates. Staged candidates change nothing until you promote
 * them; bundled rules are never rewritten.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import { mercReviewRule, mercSearch, mercStageRule, type MercRuleCandidateRow, type MercSearchOutcome } from "@/core/ipc/commands";
import { Badge, Button, EmptyState, Input, Panel, ProvenanceTag, Select, Table, Td, Th, Tr } from "@/shared/components";
import { formatRelative } from "@/shared/utilities/format";
import { CATALOG_META, catalogIndex, type SkillCategory } from "./catalog";
import { EvidenceLinks, fmtPrice } from "./components";
import { LISTINGS_PER_SEARCH } from "./query";
import { FAMILY_RULES, RULES_REVIEW_BY, RULES_VERSION, sampleClass, validThresholds, type SampleThresholds } from "./rules";
import { divineRate, stats } from "./valuation";

interface Props {
  league: string | null;
  thresholds: SampleThresholds;
  onThresholds: (t: SampleThresholds) => void;
  candidates: { rows: MercRuleCandidateRow[] | null; error: string | null; reload: () => void };
}

export default function ResearchAdmin({ league, thresholds, onThresholds, candidates }: Props) {
  const idx = catalogIndex();
  const [family, setFamily] = useState("kineticist");
  const fam = idx.familyById.get(family)!;
  const rules = FAMILY_RULES.find((r) => r.family === family) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Catalog" meta={<ProvenanceTag provenance={{ kind: "game-data", source: "PoEDB + official Trade stats", at: Date.parse(CATALOG_META.generatedAt), patch: CATALOG_META.gameVersion }} />}>
        <p className="mb-3 text-xs text-fg-muted">
          {CATALOG_META.counts.families} families · {CATALOG_META.counts.variants} warrant types · {CATALOG_META.counts.skills} skills · {CATALOG_META.counts.supportIdentities} rollable support identities ·{" "}
          {(CATALOG_META.counts.officialSkillStats ?? 0) + (CATALOG_META.counts.officialSupportStats ?? 0)} official stat ids · catalog {CATALOG_META.catalogVersion}, generated {CATALOG_META.generatedAt} · rules {RULES_VERSION}, review by {RULES_REVIEW_BY}
        </p>
        <Table dense>
          <thead>
            <tr>
              <Th>Family</Th>
              <Th>House</Th>
              <Th>Attributes</Th>
              <Th>Variants</Th>
              <Th numeric>Skills</Th>
              <Th>Tier (survey)</Th>
              <Th numeric>Rules</Th>
            </tr>
          </thead>
          <tbody>
            {idx.catalog.families.map((f) => {
              const r = FAMILY_RULES.find((x) => x.family === f.id);
              return (
                <Tr key={f.id} interactive selected={f.id === family} onClick={() => setFamily(f.id)}>
                  <Td>{f.name}</Td>
                  <Td muted>{f.house}</Td>
                  <Td muted>{f.attributes.join(" / ")}</Td>
                  <Td muted>{f.variants.map((v) => (v.infamous ? "Infamous" : "Normal")).join(", ")}</Td>
                  <Td numeric>{Object.keys(idx.skillRules(f, null)).length}</Td>
                  <Td>{r?.tier ?? "—"}</Td>
                  <Td numeric>{(r?.packages.length ?? 0) + (r?.skills.length ?? 0)}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>

      <Panel title={`${fam.name} — pools and supports`}>
        <p className="mb-3 text-xs text-fg-muted">
          Weapons: {fam.weapons.join(", ")} · warrant types: {fam.variants.map((v) => v.warrantType).join(", ")} · PoEDB pages: {fam.variants.map((v) => v.poedb).join(", ")}
        </p>
        {(["primary", "secondary", "utility"] as SkillCategory[]).map((cat) => (
          <div key={cat} className="mb-3">
            <h4 className="mb-1 text-xs font-medium tracking-wide text-fg-subtle uppercase">{cat}</h4>
            <div className="flex flex-col gap-1">
              {(fam.variants[0]?.pools[cat] ?? []).map((id) => {
                const rule = idx.skillRule(fam, null, id)!;
                const s = idx.skillById.get(id);
                return (
                  <div key={id} className="text-sm">
                    <span className="text-fg">{idx.skillName(id)}</span>
                    {s?.trarthus && <Badge className="ml-1.5">Trarthus</Badge>}
                    {s?.vaal && <Badge className="ml-1.5">Vaal</Badge>}
                    <span className="ml-2 text-xs text-fg-subtle">
                      {rule.supportCount} supports · {idx.skillStat(fam, null, id)}
                    </span>
                    <p className="text-xs text-fg-muted">
                      {idx
                        .allowedSupports(rule)
                        .map((a) => `${idx.supportById.get(a.support)?.name} ${a.tiers.map((t) => `T${t}`).join("/")}`)
                        .join(" · ")}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </Panel>

      <Panel title={`${fam.name} — rules and evidence`}>
        {!rules ? (
          <p className="text-sm text-fg-muted">No rules.</p>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-fg-muted">
              Tier: {rules.tier} {rules.note ? `· ${rules.note}` : ""}
            </p>
            {rules.packages.map((p) => (
              <div key={p.skill}>
                <p className="text-fg">
                  Value package: {idx.skillName(p.skill)} {p.gates.map((g) => `+ ${idx.supportById.get(g.support)?.name} T${g.minTier}+`).join(" ")}
                </p>
                <EvidenceLinks ids={p.evidence} />
              </div>
            ))}
            {rules.skills.map((s) => (
              <div key={s.id}>
                <p className="text-fg">
                  <Badge tone={s.effect === "negative" ? "danger" : "success"}>{s.effect}</Badge> <Badge tone={s.status === "active" ? "info" : "neutral"}>{s.status}</Badge> {idx.skillName(s.skill)}
                  {s.context ? ` (beside ${idx.skillName(s.context)})` : ""}: {s.reason}
                </p>
                <p className="text-xs text-fg-subtle">
                  {s.basis} · confidence {s.confidence} · patch {s.patch} · review by {s.reviewBy}
                </p>
                <EvidenceLinks ids={s.evidence} />
              </div>
            ))}
          </div>
        )}
      </Panel>

      <ControlledComparison league={league} family={family} thresholds={thresholds} onStaged={candidates.reload} />
      <Candidates candidates={candidates} />
      <ThresholdsEditor value={thresholds} onChange={onThresholds} />
    </div>
  );
}

interface CompareResult {
  withO: MercSearchOutcome;
  withoutO: MercSearchOutcome;
  withMedian: number | null;
  withoutMedian: number | null;
  withN: number;
  withoutN: number;
  effect: "negative" | "positive" | "none";
}

function asks(o: MercSearchOutcome) {
  return o.listings.filter((l) => l.amountChaos != null && l.currency !== "mirror").map((l) => l.amountChaos!);
}

function ControlledComparison({ league, family, thresholds, onStaged }: { league: string | null; family: string; thresholds: SampleThresholds; onStaged: () => void }) {
  const idx = catalogIndex();
  const fam = idx.familyById.get(family)!;
  const rules = FAMILY_RULES.find((r) => r.family === family);
  const pkg = rules?.packages[0] ?? null;
  const options = useMemo(() => Object.keys(idx.skillRules(fam, null)).filter((id) => id !== pkg?.skill), [fam, pkg, idx]);
  const [skill, setSkill] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const variant = fam.variants.find((v) => !v.infamous) ?? fam.variants[0]!;

  const run = async () => {
    if (!league || !pkg || !skill) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const rule = idx.skillRule(fam, null, pkg.skill)!;
      const allowed = idx.allowedSupports(rule);
      const bound = [{ id: idx.skillStat(fam, null, pkg.skill)! }];
      for (const g of pkg.gates) {
        const a = allowed.find((x) => x.support === g.support)!;
        const tier = Math.max(...a.tiers.filter((t) => t >= g.minTier));
        bound.push({ id: idx.supportStat(fam, null, pkg.skill, g.support, tier)! });
      }
      const other = idx.skillStat(fam, null, skill)!;
      const q = (type: "and" | "not") => ({
        query: {
          status: { option: "securable" },
          type: { option: variant.warrantType, discriminator: "mercenary_warrant" },
          stats: [{ type: "mercenary", filters: bound }, { type, filters: [{ id: other }] }],
          filters: { misc_filters: { filters: { ilvl: { min: 83 } } } },
        },
        sort: { price: "asc" },
      });
      const base = { level: 2 as const, count: LISTINGS_PER_SEARCH, gameVersion: CATALOG_META.gameVersion, catalogVersion: CATALOG_META.catalogVersion };
      const withO = await mercSearch(league, { ...base, query: q("and"), label: `Controlled: ${fam.name} package with ${idx.skillName(skill)}` });
      const withoutO = await mercSearch(league, { ...base, query: q("not"), label: `Controlled: ${fam.name} package without ${idx.skillName(skill)}` });
      const w = stats(asks(withO));
      const wo = stats(asks(withoutO));
      const effect = w && wo ? (w.median < wo.median * 0.7 ? "negative" : w.median > wo.median * 1.3 ? "positive" : "none") : "none";
      setResult({ withO, withoutO, withMedian: w?.median ?? null, withoutMedian: wo?.median ?? null, withN: w?.count ?? 0, withoutN: wo?.count ?? 0, effect });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const d = result ? divineRate([result.withO, result.withoutO]) : null;
  const enough = result && result.withN >= thresholds.exploratory && result.withoutN >= thresholds.exploratory;
  const stage = async () => {
    if (!league || !result || !pkg) return;
    await mercStageRule(league, {
      gameVersion: CATALOG_META.gameVersion,
      catalogVersion: CATALOG_META.catalogVersion,
      ruleKey: `${family}:skill:${skill}`,
      family,
      title: `${idx.skillName(skill)} beside ${idx.skillName(pkg.skill)} package`,
      evidence: {
        skill,
        effect: result.effect === "none" ? null : result.effect,
        package: pkg.skill,
        withMedianChaos: result.withMedian,
        withoutMedianChaos: result.withoutMedian,
        withTotal: result.withO.total,
        withoutTotal: result.withoutO.total,
        withSample: sampleClass(result.withN, thresholds),
        withoutSample: sampleClass(result.withoutN, thresholds),
        divineRate: d,
        tradeUrls: [result.withO.tradeUrl, result.withoutO.tradeUrl],
        method: `median of the lowest ${LISTINGS_PER_SEARCH} instant-buyout asks each side (mirror asks excluded)`,
        league,
        at: new Date().toISOString(),
      },
      withCount: result.withN,
      withoutCount: result.withoutN,
    });
    onStaged();
  };

  return (
    <Panel title="Controlled comparison" meta={<ProvenanceTag provenance={{ kind: "market", source: "Official Trade", at: result ? result.withO.fetchedAt * 1000 : null, league: league ?? undefined }} />}>
      {!pkg ? (
        <p className="text-sm text-fg-muted">This family has no measured value package to compare against.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-fg-muted">
            Searches the {fam.name} value package ({idx.skillName(pkg.skill)} {pkg.gates.map((g) => `+ ${idx.supportById.get(g.support)?.name}`).join(" ")}) twice: with and without the chosen skill. Two Trade searches.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <Select label="Skill to test" size="sm" value={skill} onChange={setSkill} options={[{ value: "", label: "Choose…" }, ...options.map((id) => ({ value: id, label: idx.skillName(id) }))]} />
            </div>
            <Button variant="primary" size="sm" icon="search" disabled={!skill || busy || !league} onClick={() => void run()}>
              {busy ? "Searching…" : "Run comparison"}
            </Button>
          </div>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          {result && (
            <div className="mt-3 text-sm">
              <Table dense>
                <thead>
                  <tr>
                    <Th />
                    <Th numeric>On Trade</Th>
                    <Th numeric>Asks used</Th>
                    <Th>Sample</Th>
                    <Th numeric>Median (lowest asks)</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["With", result.withO, result.withN, result.withMedian],
                      ["Without", result.withoutO, result.withoutN, result.withoutMedian],
                    ] as const
                  ).map(([label, o, n, m]) => (
                    <Tr key={label}>
                      <Td>
                        {label} {idx.skillName(skill)}
                      </Td>
                      <Td numeric>{o.total ?? (o.error ? "failed" : "—")}</Td>
                      <Td numeric>{n}</Td>
                      <Td>{sampleClass(n, thresholds)}</Td>
                      <Td numeric>{fmtPrice(m, d)}</Td>
                      <Td>
                        {o.tradeUrl && (
                          <Button size="sm" variant="ghost" icon="external" onClick={() => void openUrl(o.tradeUrl!)}>
                            Trade
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-fg-muted">
                Result: {result.effect === "none" ? "no difference of 30% or more between the medians." : `${result.effect} (median with ${result.effect === "negative" ? "below 70%" : "above 130%"} of without).`} Asks, not sales.
              </p>
              <Button className="mt-2" size="sm" variant="secondary" icon="plus" disabled={!enough || result.effect === "none"} onClick={() => void stage()}>
                Stage as rule candidate
              </Button>
              {!enough && <p className="mt-1 text-xs text-fg-subtle">Needs at least {thresholds.exploratory} asks on each side to stage.</p>}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function Candidates({ candidates }: { candidates: Props["candidates"] }) {
  const idx = catalogIndex();
  const act = (id: number, status: MercRuleCandidateRow["status"]) => void mercReviewRule(id, status).then(candidates.reload);
  return (
    <Panel title="Rule candidates">
      {candidates.error ? (
        <EmptyState icon="error" title="Could not load candidates" body={candidates.error} />
      ) : !candidates.rows ? (
        <EmptyState icon="clock" loading title="Loading…" />
      ) : candidates.rows.length === 0 ? (
        <EmptyState icon="info" title="No staged rules in this league" body="Run a controlled comparison and stage it. Promoted rules are added beside the bundled ones; nothing changes until you promote." />
      ) : (
        <Table dense>
          <thead>
            <tr>
              <Th>Rule</Th>
              <Th>Status</Th>
              <Th numeric>With / without</Th>
              <Th>Staged</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {candidates.rows.map((c) => {
              const ev = c.evidence as { effect?: string | null } | null;
              return (
                <Tr key={c.id}>
                  <Td>
                    {idx.familyById.get(c.family)?.name}: {c.title} {ev?.effect && <Badge tone={ev.effect === "negative" ? "danger" : "success"}>{ev.effect}</Badge>}
                  </Td>
                  <Td>
                    <Badge tone={c.status === "promoted" ? "accent" : c.status === "rejected" ? "neutral" : "info"}>{c.status}</Badge>
                  </Td>
                  <Td numeric>
                    {c.withCount} / {c.withoutCount}
                  </Td>
                  <Td muted>{formatRelative(c.createdAt * 1000)}</Td>
                  <Td>
                    <div className="flex gap-1">
                      {c.status === "staged" && (
                        <Button size="sm" variant="ghost" onClick={() => act(c.id, "validated")}>
                          Validate
                        </Button>
                      )}
                      {c.status === "validated" && (
                        <Button size="sm" variant="secondary" onClick={() => act(c.id, "promoted")}>
                          Promote
                        </Button>
                      )}
                      {c.status !== "rejected" && (
                        <Button size="sm" variant="ghost" onClick={() => act(c.id, "rejected")}>
                          Reject
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}

function ThresholdsEditor({ value, onChange }: { value: SampleThresholds; onChange: (t: SampleThresholds) => void }) {
  const [draft, setDraft] = useState(value);
  const ok = validThresholds(draft);
  const field = (k: keyof SampleThresholds, label: string) => (
    <label className="flex flex-col gap-1 text-xs text-fg-muted">
      {label}
      <Input type="number" min={1} max={1000} value={String(draft[k])} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <Panel title="Sample thresholds">
      <p className="mb-3 text-xs text-fg-muted">Fewer asks than “exploratory” is insufficient data. Defaults: 5 / 8 / 15 / 30.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {field("exploratory", "Exploratory from")}
        {field("limited", "Limited from")}
        {field("moderate", "Moderate from")}
        {field("stronger", "Stronger from")}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={!ok} onClick={() => onChange(draft)}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft({ exploratory: 5, limited: 8, moderate: 15, stronger: 30 })}>
          Defaults
        </Button>
        {!ok && <span className="text-xs text-warning">Each threshold must be larger than the one before.</span>}
      </div>
    </Panel>
  );
}
