import { openUrl } from "@tauri-apps/plugin-opener";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import type { MercSearchOutcome, MercValuationRow } from "@/core/ipc/commands";
import { Badge, Button, EmptyState, Panel, ProvenanceTag, Select, SegmentedControl, Table, Td, Th, Tr, type BadgeTone } from "@/shared/components";
import { variants } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { formatRelative } from "@/shared/utilities/format";
import { catalogIndex } from "./catalog";
import { LEVEL_LABEL, type Level, type SearchPlan } from "./query";
import { evidenceById, effectiveRules, type Evidence } from "./rules";
import type { Field, FieldStatus, ParsedWarrant, WarrantCorrections } from "./types";
import { CATEGORY_LABEL, CONFIDENCE_LABEL, FRESHNESS_LABEL, type Confidence, type Freshness, type LevelResult, type Valuation } from "./valuation";

// ---------- formatting ----------

export function fmtPrice(chaos: number | null | undefined, divine: number | null): string {
  if (chaos == null || !Number.isFinite(chaos)) return "—";
  if (divine && chaos >= divine) {
    const d = chaos / divine;
    return `${d >= 100 ? Math.round(d) : d.toFixed(d < 10 ? 2 : 1).replace(/\.?0+$/, "")} div`;
  }
  return `${Math.round(chaos)} c`;
}
const fmtAsk = (amount: number | null, currency: string | null) => (amount == null ? "No price" : `${amount} ${currency ?? ""}`.trim());

const STATUS_TONE: Record<FieldStatus, BadgeTone> = { confirmed: "success", inferred: "info", ambiguous: "warning", unknown: "danger" };
export function StatusBadge<T>({ field }: { field: Field<T> }) {
  return (
    <span title={field.note}>
      <Badge tone={STATUS_TONE[field.status]}>{field.corrected ? "corrected" : field.status}</Badge>
    </span>
  );
}
const CONF_TONE: Record<Confidence, BadgeTone> = { high: "success", medium: "info", low: "warning", insufficient: "neutral" };
const FRESH_TONE: Record<Freshness, BadgeTone> = { fresh: "success", recent: "info", stale: "warning", "very-stale": "danger", unavailable: "danger" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right text-fg">{children}</span>
    </div>
  );
}

// ---------- overview ----------

export function WarrantOverview({ warrant, corrections, onCorrect }: { warrant: ParsedWarrant; corrections: WarrantCorrections; onCorrect: (c: WarrantCorrections) => void }) {
  const idx = catalogIndex();
  const family = warrant.family.value ? idx.familyById.get(warrant.family.value) : null;
  const variantOptions = idx.catalog.families.flatMap((f) => f.variants.map((v) => ({ value: v.id, label: v.name })));
  const needsVariant = warrant.variant.status !== "confirmed" || warrant.variant.corrected;
  const correctSkill = (i: number, skill: string) => onCorrect({ ...corrections, skills: { ...corrections.skills, [i]: { ...corrections.skills?.[i], skill } } });
  const correctSupport = (i: number, j: number, v: { support: string; tier: number } | null) =>
    onCorrect({ ...corrections, skills: { ...corrections.skills, [i]: { ...corrections.skills?.[i], supports: { ...corrections.skills?.[i]?.supports, [j]: v } } } });

  return (
    <Panel title="Warrant" meta={<ProvenanceTag provenance={{ kind: "user", source: "Your Ctrl+C text", at: null, note: "Kept in memory only" }} />}>
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <Row label="Family">
          <span className="inline-flex items-center gap-2">
            {family?.name ?? "Unknown"} <StatusBadge field={warrant.family} />
          </span>
        </Row>
        <Row label="Variant">
          <span className="inline-flex items-center gap-2">
            {warrant.variant.value ? (warrant.infamous.value ? "Infamous" : "Normal") : "Unknown"} <StatusBadge field={warrant.variant} />
          </span>
        </Row>
        <Row label="Mercenary level">
          <span className="inline-flex items-center gap-2">
            {warrant.level.value ?? "—"} <StatusBadge field={warrant.level} />
          </span>
        </Row>
        <Row label="House · attributes">{family ? `${family.house ?? "?"} · ${family.attributes.join(" / ")}` : "—"}</Row>
        {warrant.mercName && <Row label="Mercenary">{warrant.mercName}</Row>}
        <Row label="Weapons">{family?.weapons.join(", ") || "—"}</Row>
      </div>
      {needsVariant && (
        <div className="mt-3 max-w-sm">
          <Select
            label="Correct the build (Normal / Infamous)"
            value={(warrant.variant.value ?? "") as string}
            onChange={(v) => onCorrect({ ...corrections, variant: v })}
            options={[{ value: "", label: "Choose…" }, ...variantOptions]}
            size="sm"
          />
        </div>
      )}
      {warrant.level.status !== "confirmed" && (
        <div className="mt-3 max-w-sm">
          <Select
            label="Correct the mercenary level"
            value={String(corrections.level ?? "")}
            onChange={(v) => onCorrect({ ...corrections, level: Number(v) || undefined })}
            options={[{ value: "", label: "Choose…" }, ...[84, 83, 82, 81, 80, 79, 78, 75, 70].map((n) => ({ value: String(n), label: String(n) }))]}
            size="sm"
          />
        </div>
      )}

      <h3 className="mt-5 mb-2 text-xs font-medium tracking-wide text-fg-subtle uppercase">Skills and their supports</h3>
      <div className="flex flex-col gap-2">
        {warrant.skills.map((s, i) => {
          const rule = family && s.skill.value ? idx.skillRule(family, null, s.skill.value) : null;
          const allowed = rule ? idx.allowedSupports(rule) : [];
          const poolOptions = family ? Object.keys(idx.skillRules(family, null)).map((id) => ({ value: id, label: idx.skillName(id) })) : [];
          return (
            <div key={i} className="rounded-md border border-line bg-bg-2">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <Icon name="gem" size={14} className="text-fg-subtle" />
                <span className="font-medium text-fg">{s.skill.value ? idx.skillName(s.skill.value) : s.name}</span>
                {s.category && <Badge>{s.category}</Badge>}
                <StatusBadge field={s.skill} />
                {s.skill.status !== "confirmed" && poolOptions.length > 0 && (
                  <Select label="Correct skill" hideLabel size="sm" value={s.skill.value ?? ""} onChange={(v) => correctSkill(i, v)} options={[{ value: "", label: "Correct skill…" }, ...poolOptions]} />
                )}
                {s.skill.note && <span className="text-xs text-fg-muted">{s.skill.note}</span>}
              </div>
              {s.supports.length ? (
                <ul className="flex flex-col py-1 pl-8">
                  {s.supports.map((p, j) => (
                    <li key={j} className="flex flex-wrap items-center gap-2 py-0.5 pr-3 text-sm">
                      <span className="text-fg-subtle" aria-hidden>
                        └
                      </span>
                      <span className="text-fg">{p.support.value ? idx.supportById.get(p.support.value)?.name : p.name}</span>
                      <Badge tone={p.tier.value === 3 ? "accent" : "neutral"}>T{p.tier.value ?? "?"}</Badge>
                      {(p.support.status !== "confirmed" || p.tier.status !== "confirmed") && (p.support.status !== "confirmed" ? <StatusBadge field={p.support} /> : <StatusBadge field={p.tier} />)}
                      {p.support.corrected && <Badge tone="info">corrected</Badge>}
                      {(p.support.status !== "confirmed" || p.tier.status !== "confirmed") && allowed.length > 0 && (
                        <>
                          <Select
                            label="Correct support"
                            hideLabel
                            size="sm"
                            value=""
                            onChange={(v) => {
                              if (v === "__remove") correctSupport(i, j, null);
                              else if (v) {
                                const [support = "", tier] = v.split(":");
                                correctSupport(i, j, { support, tier: Number(tier) });
                              }
                            }}
                            options={[
                              { value: "", label: "Correct…" },
                              ...allowed.flatMap((a) => a.tiers.map((t) => ({ value: `${a.support}:${t}`, label: `${idx.displayOf(a.support, t)} (T${t})` }))),
                              { value: "__remove", label: "Not on this warrant (remove)" },
                            ]}
                          />
                          {(p.support.note || p.tier.note) && <span className="text-xs text-fg-muted">{p.support.note ?? p.tier.note}</span>}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-8 py-1.5 text-xs text-fg-subtle">No supports</p>
              )}
            </div>
          );
        })}
      </div>
      {(warrant.problems.length > 0 || warrant.unparsed.length > 0) && (
        <div className="mt-3 flex flex-col gap-1 text-xs text-warning">
          {warrant.problems.map((p) => (
            <p key={p}>⚠ {p}</p>
          ))}
          {warrant.unparsed.length > 0 && <p>Not understood: {warrant.unparsed.join(" · ")}</p>}
        </div>
      )}
      {warrant.ignored.length > 0 && <p className="mt-2 text-xs text-fg-subtle">Not used for value: {warrant.ignored.join(" · ")}</p>}
    </Panel>
  );
}

// ---------- valuation ----------

export function ValuationCard({ v, running }: { v: Valuation | null; running: boolean }) {
  if (!v) {
    return (
      <Panel title="Valuation">
        <EmptyState icon={running ? "search" : "priceCheck"} loading={running} title={running ? "Searching the official Trade site…" : "Not checked yet"} body={running ? "One comparison level at a time, inside the Trade rate limits." : "Check the market to get comparable listings for this warrant."} />
      </Panel>
    );
  }
  const d = v.divineRate;
  const chosen = v.chosen;
  return (
    <motion.div variants={variants.rise} initial="hidden" animate="visible">
      <Panel
        title="Valuation"
        meta={<ProvenanceTag provenance={{ kind: "estimate", source: "Vaalytics from Official Trade asks", at: chosen?.outcome ? chosen.outcome.fetchedAt * 1000 : null, note: "Asking prices, not sales" }} />}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={v.category === "premium" || v.category === "high" ? "accent" : v.category === "unknown" ? "neutral" : "info"}>{CATEGORY_LABEL[v.category]}</Badge>
          <Badge tone={CONF_TONE[v.confidence]}>Confidence: {CONFIDENCE_LABEL[v.confidence]}</Badge>
          {chosen && <Badge>Level {chosen.level}: {LEVEL_LABEL[chosen.level]}</Badge>}
          {chosen && <Badge tone={FRESH_TONE[chosen.freshness]}>{FRESHNESS_LABEL[chosen.freshness]}</Badge>}
        </div>
        {v.confidence === "insufficient" ? (
          <p className="mt-4 text-sm text-fg">Insufficient data — Vaalytics won't put a price on this warrant.</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Suggested list price" value={fmtPrice(v.suggested, d)} strong />
            <Figure label="Asking range (p25–p75)" value={v.askingRange ? `${fmtPrice(v.askingRange[0], d)} – ${fmtPrice(v.askingRange[1], d)}` : "—"} />
            <Figure label="Quick-sale target" value={fmtPrice(v.quickSale, d)} />
            <Figure label="Comparable median" value={fmtPrice(chosen?.stats?.median, d)} sub={`${chosen?.stats?.count ?? 0} asks`} />
          </div>
        )}
        <p className="mt-3 text-xs text-fg-subtle">Estimate from asking prices on the official Trade site (not sales). {d ? `1 div = ${Math.round(d)} c (poe.ninja, as used).` : "No divine rate available."}</p>
        <ul className="mt-3 flex flex-col gap-1 text-xs text-fg-muted">
          {[...v.confidenceReasons, ...v.categoryReasons].map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      </Panel>
    </motion.div>
  );
}

function Figure({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={cn("tabular mt-0.5 text-lg", strong ? "font-semibold text-accent" : "text-fg")}>{value}</p>
      {sub && <p className="text-xs text-fg-subtle">{sub}</p>}
    </div>
  );
}

// ---------- breakdown ----------

const IND_TONE = { high: "success", medium: "info", low: "warning", unknown: "neutral" } as const;
const EFFECT: Record<"positive" | "negative" | "neutral" | "limits", { tone: BadgeTone; label: string }> = {
  positive: { tone: "success", label: "adds value" },
  negative: { tone: "danger", label: "lowers value" },
  neutral: { tone: "neutral", label: "context" },
  limits: { tone: "warning", label: "limits confidence" },
};

export function Breakdown({ v }: { v: Valuation }) {
  return (
    <Panel title="Value breakdown">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Object.values(v.indicators).map((i) => (
          <div key={i.label} className="rounded-md border border-line bg-bg-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-muted">{i.label}</span>
              <Badge tone={IND_TONE[i.level]}>{i.level}</Badge>
            </div>
            <p className="mt-1.5 text-xs text-fg">{i.text}</p>
          </div>
        ))}
      </div>
      <ul className="mt-4 flex flex-col divide-y divide-line">
        {v.factors.map((f) => (
          <li key={f.id} className="flex flex-col gap-1 py-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={EFFECT[f.effect].tone}>{EFFECT[f.effect].label}</Badge>
              <span className="text-fg">{f.text}</span>
            </div>
            {f.evidence.length > 0 && <EvidenceLinks ids={f.evidence} />}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function EvidenceLinks({ ids }: { ids: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 pl-1">
      {ids.map((id) => evidenceById.get(id)).filter((e): e is Evidence => !!e).map((e) => (
        <EvidenceChip key={e.id} e={e} />
      ))}
    </div>
  );
}

function EvidenceChip({ e }: { e: Evidence }) {
  const tone: BadgeTone = e.kind === "opinion" ? "warning" : e.kind === "observation" ? "info" : "neutral";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted" title={e.text}>
      <Badge tone={tone}>{e.kind === "opinion" ? "opinion" : e.kind}</Badge>
      {e.url ? (
        <button type="button" className="underline decoration-line-strong underline-offset-2 hover:text-fg" onClick={() => void openUrl(e.url!)}>
          {e.source}
        </button>
      ) : (
        e.source
      )}
      <span className="text-fg-subtle">
        {e.date}
        {e.n != null ? ` · n=${e.n}` : ""}
      </span>
    </span>
  );
}

// ---------- comparables ----------

export function Comparables({ v, plans }: { v: Valuation; plans: SearchPlan[] }) {
  const available = v.levels.filter((l) => l.outcome);
  const [level, setLevel] = useState<Level>(v.chosen?.level ?? available[0]?.level ?? 4);
  const current: LevelResult | undefined = available.find((l) => l.level === level) ?? available[0];
  const plan = plans.find((p) => p.level === current?.level);
  const d = v.divineRate;
  if (!current) return null;
  const o = current.outcome as MercSearchOutcome;
  return (
    <Panel
      title="Comparable listings"
      actions={
        o.tradeUrl ? (
          <Button size="sm" variant="secondary" icon="external" onClick={() => void openUrl(o.tradeUrl!)}>
            Open on Trade
          </Button>
        ) : undefined
      }
    >
      <SegmentedControl
        label="Comparison level"
        size="sm"
        value={String(current.level) as `${Level}`}
        onChange={(x) => setLevel(Number(x) as Level)}
        segments={available.map((l) => ({ value: String(l.level) as `${Level}`, label: `${l.level} · ${LEVEL_LABEL[l.level]}` }))}
      />
      <FreshnessRow o={o} f={current.freshness} />
      {plan && (
        <p className="mt-2 text-xs text-fg-muted">
          Query: {plan.constraints.join(" · ") || "warrant type only"}
          {plan.dropped.length > 0 && <span className="text-warning"> · not included (Trade limits): {plan.dropped.join(", ")}</span>}
          {current.level === 1 && <span> · exact matches are verified on each listing's full skills, never assumed from the query.</span>}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Mini label="On Trade" value={String(o.total ?? "—")} />
        <Mini label="Fetched (lowest asks)" value={String(o.listings.length)} />
        <Mini label="Raw median" value={fmtPrice(current.raw?.median, d)} />
        <Mini label="Filtered median (p25–p75)" value={current.stats ? `${fmtPrice(current.stats.median, d)} (${fmtPrice(current.stats.p25, d)}–${fmtPrice(current.stats.p75, d)})` : "—"} />
      </div>
      {o.listings.length === 0 ? (
        <EmptyState icon={o.status === "error" ? "error" : "search"} title={o.status === "error" ? "Search failed" : "No listings"} body={o.error ?? "Nobody lists this on Trade right now."} />
      ) : (
        <Table dense className="mt-3">
          <thead>
            <tr>
              <Th numeric>Ask</Th>
              <Th numeric>In chaos</Th>
              <Th>Match</Th>
              <Th>Differences</Th>
              <Th>Listed</Th>
            </tr>
          </thead>
          <tbody>
            {current.filtered?.kept.map((k) => (
              <Tr key={k.listing.id}>
                <Td numeric>{fmtAsk(k.listing.amount, k.listing.currency)}</Td>
                <Td numeric>{fmtPrice(k.chaos, d)}</Td>
                <Td>
                  <Badge tone={k.match === "exact" ? "success" : k.match === "package" ? "info" : "neutral"}>{k.match}</Badge>
                </Td>
                <Td muted className="max-w-80 truncate" title={k.differences.join(", ")}>
                  {k.differences.join(", ") || "—"}
                </Td>
                <Td muted>{k.listing.indexed ? formatRelative(Date.parse(k.listing.indexed)) : "—"}</Td>
              </Tr>
            ))}
            {current.filtered?.excluded.map((e) => (
              <Tr key={`x-${e.id}`} className="opacity-60">
                <Td numeric>{fmtAsk(e.amount, e.currency)}</Td>
                <Td numeric>—</Td>
                <Td>
                  <Badge tone="warning">excluded</Badge>
                </Td>
                <Td muted colSpan={2}>
                  {e.reason}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-2 text-xs text-fg-subtle">Instant-buyout listings only (Trade status “securable”), sorted by price, lowest {o.listings.length} fetched. Seller names are not shown or stored.</p>
    </Panel>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-line bg-bg-2 px-2 py-1.5">
      <p className="text-fg-subtle">{label}</p>
      <p className="tabular text-sm text-fg">{value}</p>
    </div>
  );
}

export function FreshnessRow({ o, f }: { o: MercSearchOutcome; f: Freshness }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      <Badge tone={FRESH_TONE[f]} dot>
        {FRESHNESS_LABEL[f]} · Official Trade
      </Badge>
      <span>
        {o.status === "error" && !o.stale ? "Never fetched" : `Fetched ${formatRelative(o.fetchedAt * 1000)}`}
        {o.cached && !o.stale ? " (cached, ≤ 10 min)" : ""}
      </span>
      {o.error && <span className="text-danger">{o.stale ? `Refresh failed — showing the older snapshot: ${o.error}` : o.error}</span>}
      {o.skippedListings > 0 && <span className="text-warning">{o.skippedListings} listing(s) skipped (unexpected data)</span>}
      <span className="text-fg-subtle">· {o.league} · catalog {o.catalogVersion}</span>
    </div>
  );
}

// ---------- research evidence ----------

export function ResearchEvidence({ family }: { family: string | null }) {
  const [open, setOpen] = useState(false);
  const rules = effectiveRules(family);
  const idx = catalogIndex();
  return (
    <Panel
      title="Research evidence"
      actions={
        <Button size="sm" variant="ghost" icon={open ? "chevronUp" : "chevronDown"} onClick={() => setOpen((x) => !x)}>
          {open ? "Hide" : "Show"}
        </Button>
      }
    >
      {!rules ? (
        <p className="text-sm text-fg-muted">No family resolved.</p>
      ) : !open ? (
        <p className="text-sm text-fg-muted">
          {rules.packages.length} value package(s), {rules.skills.length} skill rule(s) for {idx.familyById.get(rules.family)?.name}. Family tier: {rules.tier}.
        </p>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {rules.packages.map((p) => (
            <div key={p.skill}>
              <p className="text-fg">
                Package: {idx.skillName(p.skill)}
                {p.gates.length ? ` + ${p.gates.map((g) => `${idx.supportById.get(g.support)?.name} T${g.minTier}+`).join(" + ")}` : ""}
              </p>
              <EvidenceLinks ids={p.evidence} />
            </div>
          ))}
          {rules.skills.map((s) => (
            <div key={s.id}>
              <p className="text-fg">
                <Badge tone={s.effect === "negative" ? "danger" : "success"}>{s.effect}</Badge> <Badge tone={s.status === "active" ? "info" : "neutral"}>{s.status}</Badge> {idx.skillName(s.skill)} — {s.reason}
              </p>
              <p className="text-xs text-fg-subtle">
                Basis: {s.basis} · confidence {s.confidence} · patch {s.patch} · review by {s.reviewBy}
              </p>
              <EvidenceLinks ids={s.evidence} />
            </div>
          ))}
          {rules.note && <p className="text-xs text-fg-muted">{rules.note}</p>}
        </div>
      )}
    </Panel>
  );
}

// ---------- history ----------

export function MarketHistory({ rows, error, divine, onDelete }: { rows: MercValuationRow[] | null; error: string | null; divine: number | null; onDelete: (id: number) => void }) {
  return (
    <Panel title="Market history" meta={<ProvenanceTag provenance={{ kind: "historical", source: "Your earlier checks", at: rows?.[0] ? rows[0].createdAt * 1000 : null }} />}>
      {error ? (
        <EmptyState icon="error" title="History could not be loaded" body={error} />
      ) : !rows ? (
        <EmptyState icon="clock" loading title="Loading…" />
      ) : rows.length === 0 ? (
        <EmptyState icon="clock" title="No history for this warrant in this league yet" body="Each market check is kept here, per league. Leagues are never mixed." />
      ) : (
        <Table dense>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Result</Th>
              <Th numeric>Median</Th>
              <Th numeric>Asks</Th>
              <Th>Level</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td muted>{formatRelative(r.createdAt * 1000)}</Td>
                <Td>
                  {CATEGORY_LABEL[r.category as keyof typeof CATEGORY_LABEL] ?? r.category} · {CONFIDENCE_LABEL[r.confidence as Confidence] ?? r.confidence}
                </Td>
                <Td numeric>{fmtPrice(r.medianChaos, r.divineRate ?? divine)}</Td>
                <Td numeric>{r.count}</Td>
                <Td muted>{r.level ?? "—"}</Td>
                <Td>
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => onDelete(r.id)} aria-label="Delete this entry" />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
