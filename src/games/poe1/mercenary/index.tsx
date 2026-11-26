/**
 * Mercenary Intelligence (PoE 1): "I have this Warrant. Is it worth selling, what makes it
 * valuable, what should I ask, and how strong is the evidence?" — from comparable listings on
 * the official Trade site, never from a score. Not a build advisor.
 * Spec: docs/modules/mercenary-intelligence.md
 */
import { useMemo, useState } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import { mercDeleteValuation, type JsonValue } from "@/core/ipc/commands";
import { usePatch } from "@/core/game-data";
import { useLeague } from "@/core/market/LeagueContext";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { Badge, Button, EmptyState, Kbd, PageHeader, Panel, SegmentedControl } from "@/shared/components";
import { LeagueSelect } from "@/shared/views/market-ui";
import { CATALOG_META } from "./catalog";
import { Breakdown, Comparables, MarketHistory, ResearchEvidence, ValuationCard, WarrantOverview } from "./components";
import { useMarketRun, useRuleCandidates, useValuationHistory } from "./hooks";
import { applyCorrections, bindingCheck, fingerprint, parseWarrant } from "./parse";
import { LEVEL_LABEL } from "./query";
import ResearchAdmin from "./ResearchAdmin";
import { DEFAULT_THRESHOLDS, validThresholds, type SampleThresholds } from "./rules";
import type { WarrantCorrections } from "./types";

export const THRESHOLDS_KEY = "mercenary.thresholds";
const isThresholds = (v: unknown): v is JsonValue => !!v && typeof v === "object" && validThresholds(v as SampleThresholds);

type Tab = "value" | "research";

const firstError = (o: Record<number, { status: string; error: string | null } | null | undefined>) => Object.values(o).find((x) => x?.status === "error")?.error ?? null;

export default function MercenaryIntelligence(_props: SectionProps) {
  const { league } = useLeague();
  const patch = usePatch("poe1");
  const [tab, setTab] = useState<Tab>("value");
  const [stored, setStored] = useGameSetting<JsonValue>("poe1", THRESHOLDS_KEY, DEFAULT_THRESHOLDS as unknown as JsonValue, isThresholds);
  const thresholds = stored as unknown as SampleThresholds;
  const candidates = useRuleCandidates(league);
  const patchMismatch = patch.definition?.patch && !CATALOG_META.gameVersion.startsWith(patch.definition.patch);

  return (
    <div className="mx-auto max-w-page">
      <PageHeader
        title="Mercenary Intelligence"
        description="Value a Mercenary Warrant for sale from comparable listings on the official Trade site: what makes it valuable, what to ask, and how strong the evidence is."
        actions={<LeagueSelect />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="View"
          value={tab}
          onChange={setTab}
          segments={[
            { value: "value", label: "Value a warrant" },
            { value: "research", label: "Research" },
          ]}
        />
        <span className="text-xs text-fg-subtle">
          Catalog {CATALOG_META.catalogVersion} · PoE {CATALOG_META.gameVersion} · {league ?? "no league"}
        </span>
        {patchMismatch && <Badge tone="warning">The selected league uses patch {patch.definition?.patch}; the catalog is for {CATALOG_META.gameVersion}</Badge>}
      </div>
      {tab === "value" ? (
        <ValueTab league={league} thresholds={thresholds} />
      ) : (
        <ResearchAdmin league={league} thresholds={thresholds} onThresholds={(t) => setStored(t as unknown as JsonValue)} candidates={candidates} />
      )}
    </div>
  );
}

function ValueTab({ league, thresholds }: { league: string | null; thresholds: SampleThresholds }) {
  const [text, setText] = useState("");
  const [corrections, setCorrections] = useState<WarrantCorrections>({});
  const parsed = useMemo(() => parseWarrant(text), [text]);
  const warrant = useMemo(() => (parsed ? applyCorrections(parsed, corrections) : null), [parsed, corrections]);
  const fp = warrant ? fingerprint(warrant) : null;
  const history = useValuationHistory(league, fp);
  const { run, start } = useMarketRun(warrant, league, thresholds, history.reload);
  const binding = warrant ? bindingCheck(warrant) : null;
  const running = run.state === "running";

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <Panel title="Warrant input">
          <p className="mb-2 text-xs text-fg-muted">
            Hover the warrant in game, press <Kbd>Ctrl</Kbd>
            <Kbd>C</Kbd>, then paste it here with <Kbd>Ctrl</Kbd>
            <Kbd>V</Kbd>. The Price Checker hotkey also opens warrants here. The text stays in memory only.
          </p>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value.slice(0, 64 * 1024));
              setCorrections({});
            }}
            rows={8}
            spellCheck={false}
            placeholder={"Item Class: Map Fragments\nRarity: Normal\nMercenary Warrant\n--------\n…"}
            className="w-full resize-y rounded-md border border-line bg-bg-2 px-3 py-2 font-mono text-xs text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
            aria-label="Warrant text"
          />
          <div className="mt-2 flex items-center gap-2">
            {text && (
              <Button size="sm" variant="ghost" icon="close" onClick={() => setText("")}>
                Clear
              </Button>
            )}
            {text && !parsed && <span className="text-xs text-warning">This doesn't look like a Mercenary Warrant.</span>}
          </div>
        </Panel>
        {warrant && <WarrantOverview warrant={warrant} corrections={corrections} onCorrect={setCorrections} />}
        {warrant && <ResearchEvidence family={warrant.family.value} />}
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        {!warrant ? (
          <Panel title="Valuation">
            <EmptyState icon="priceCheck" title="Paste a warrant to begin" body="Family, skills, bound supports and tiers are read first; unclear fields can be corrected before any search." />
          </Panel>
        ) : (
          <>
            <Panel title="Market check">
              {run.problems.map((p) => (
                <p key={p} className="mb-2 text-xs text-warning">
                  {p}
                </p>
              ))}
              {binding && !binding.certain && <p className="mb-2 text-xs text-warning">Some fields aren't confirmed — the estimate will be capped at Low confidence until you correct them.</p>}
              <ol className="mb-3 flex flex-col gap-1 text-xs text-fg-muted">
                {run.plans.map((p) => {
                  const o = run.outcomes[p.level];
                  return (
                    <li key={p.level} className="flex flex-wrap items-center gap-2">
                      <Badge tone={o ? (o.status === "ok" ? "success" : o.stale ? "warning" : "danger") : run.current === p.level ? "info" : "neutral"}>
                        {o ? (o.status === "ok" ? `${o.total ?? 0} found` : o.stale ? "stale" : "failed") : run.current === p.level ? "searching" : "pending"}
                      </Badge>
                      <span className="text-fg">
                        {p.level} · {LEVEL_LABEL[p.level]}
                      </span>
                      <span>{p.constraints.join(" · ") || "warrant type"}</span>
                    </li>
                  );
                })}
              </ol>
              {firstError(run.outcomes) && <p className="mb-3 rounded-sm border border-danger/25 bg-danger-soft px-2 py-1.5 text-xs text-danger">{firstError(run.outcomes)}</p>}
              <div className="flex items-center gap-2">
                <Button variant="primary" icon="search" disabled={running || !league || run.plans.length === 0} onClick={() => void start(false)}>
                  {running ? "Checking…" : run.state === "done" ? "Check again" : "Check the market"}
                </Button>
                {run.state === "done" && (
                  <Button variant="ghost" icon="refresh" disabled={running} onClick={() => void start(true)}>
                    Refresh (ignore 10-min cache)
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-fg-subtle">Up to {run.plans.length} searches through the shared Trade rate limiter. Needs your contact in Settings → Price checker.</p>
            </Panel>
            <ValuationCard v={run.valuation} running={running} />
            {run.valuation && <Breakdown v={run.valuation} />}
            {run.valuation && <Comparables key={fp ?? ""} v={run.valuation} plans={run.plans} />}
            <MarketHistory
              rows={history.rows}
              error={history.error}
              divine={run.valuation?.divineRate ?? null}
              onDelete={(id) => void mercDeleteValuation(id).then(history.reload)}
            />
          </>
        )}
      </div>
    </div>
  );
}
