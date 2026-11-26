import { useCallback, useEffect, useRef, useState } from "react";
import {
  mercRuleCandidates,
  mercSaveValuation,
  mercSearch,
  mercValuations,
  type JsonValue,
  type MercRuleCandidateRow,
  type MercSearchOutcome,
  type MercValuationRow,
} from "@/core/ipc/commands";
import { CATALOG_META } from "./catalog";
import { fingerprint } from "./parse";
import { COMPLEXITY_BUDGET, planSearches, type Level, type SearchPlan } from "./query";
import { RULES_VERSION, setPromotedRules, type SampleThresholds } from "./rules";
import type { ParsedWarrant } from "./types";
import { CATEGORY_LABEL, value, type Valuation } from "./valuation";

export type RunState = "idle" | "running" | "done";

export interface MarketRun {
  state: RunState;
  plans: SearchPlan[];
  problems: string[];
  outcomes: Partial<Record<Level, MercSearchOutcome | null>>;
  /** Level currently being searched. */
  current: Level | null;
  valuation: Valuation | null;
}

const EMPTY: MarketRun = { state: "idle", plans: [], problems: [], outcomes: {}, current: null, valuation: null };

/** Runs the comparison levels one after another through Rust (rate limiter, cache), then values. */
export function useMarketRun(warrant: ParsedWarrant | null, league: string | null, thresholds: SampleThresholds, onSaved?: () => void) {
  const [run, setRun] = useState<MarketRun>(EMPTY);
  const token = useRef(0);
  const key = warrant ? fingerprint(warrant) : null;

  // A different warrant invalidates the previous run; a correction re-values with the same listings.
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!warrant) {
      setRun(EMPTY);
      lastKey.current = null;
      return;
    }
    setRun((r) => {
      const { plans, problems } = planSearches(warrant);
      if (r.state === "done" && lastKey.current && sameSearches(r.plans, plans)) {
        return { ...r, valuation: value(warrant, r.outcomes, Date.now() / 1000, thresholds) };
      }
      return { ...EMPTY, plans, problems };
    });
    lastKey.current = key;
  }, [key, warrant, thresholds]);

  const start = useCallback(
    async (force = false) => {
      if (!warrant || !league) return;
      const my = ++token.current;
      const { plans, problems } = planSearches(warrant);
      const outcomes: MarketRun["outcomes"] = {};
      setRun({ state: "running", plans, problems, outcomes: {}, current: plans[0]?.level ?? null, valuation: null });
      for (let i = 0; i < plans.length; i++) {
        let p = plans[i]!;
        if (token.current !== my) return;
        setRun((r) => ({ ...r, current: p.level }));
        const send = (plan: SearchPlan) =>
          mercSearch(league, { ...plan.request, level: plan.level, gameVersion: CATALOG_META.gameVersion, catalogVersion: CATALOG_META.catalogVersion, force }).catch((e) => failed(plan, league, e));
        let o = await send(p);
        // The complexity limit is the server's; if our estimate was short, trim once more and retry.
        if (o.status === "error" && /too complex/i.test(o.error ?? "")) {
          const smaller = planSearches(warrant, undefined, COMPLEXITY_BUDGET - 4).plans.find((x) => x.level === p.level);
          if (smaller && JSON.stringify(smaller.request.query) !== JSON.stringify(p.request.query)) {
            p = smaller;
            plans[i] = smaller;
            o = await send(smaller);
          }
        }
        outcomes[p.level] = o;
        setRun((r) => ({ ...r, outcomes: { ...outcomes } }));
      }
      if (token.current !== my) return;
      const v = value(warrant, outcomes, Date.now() / 1000, thresholds);
      setRun({ state: "done", plans, problems, outcomes, current: null, valuation: v });
      if (Object.values(outcomes).some((o) => o?.status === "ok")) {
        await mercSaveValuation(league, {
          gameVersion: CATALOG_META.gameVersion,
          catalogVersion: CATALOG_META.catalogVersion,
          rulesVersion: RULES_VERSION,
          fingerprint: fingerprint(warrant).slice(0, 2048),
          family: warrant.family.value ?? "unknown",
          title: `${warrant.infamous.value ? "Infamous " : ""}${warrant.family.value ?? "Unknown"} · ${CATEGORY_LABEL[v.category]}`,
          category: v.category,
          confidence: v.confidence,
          level: v.chosen?.level ?? null,
          count: v.chosen?.stats?.count ?? 0,
          p25Chaos: v.chosen?.stats?.p25 ?? null,
          medianChaos: v.chosen?.stats?.median ?? null,
          p75Chaos: v.chosen?.stats?.p75 ?? null,
          divineRate: v.divineRate,
          summary: summary(v),
        }).catch(() => undefined);
        onSaved?.();
      }
    },
    [warrant, league, thresholds, onSaved],
  );

  return { run, start };
}

function sameSearches(a: SearchPlan[], b: SearchPlan[]) {
  return a.length === b.length && a.every((p, i) => JSON.stringify(p.request.query) === JSON.stringify(b[i]?.request.query));
}

function failed(p: SearchPlan, league: string, e: unknown): MercSearchOutcome {
  return {
    snapshotId: null,
    status: "error",
    error: String(e),
    league,
    queryHash: "",
    level: p.level,
    label: p.label,
    searchId: null,
    total: null,
    complexity: null,
    tradeUrl: null,
    fetchedAt: Math.floor(Date.now() / 1000),
    cached: false,
    stale: false,
    skippedListings: 0,
    ratesAvailable: false,
    rates: {},
    listings: [],
    gameVersion: CATALOG_META.gameVersion,
    catalogVersion: CATALOG_META.catalogVersion,
  };
}

function summary(v: Valuation): JsonValue {
  return {
    askingRange: v.askingRange,
    suggested: v.suggested,
    quickSale: v.quickSale,
    reasons: v.confidenceReasons.slice(0, 6),
    levels: v.levels.map((l) => ({ level: l.level, total: l.outcome?.total ?? null, kept: l.stats?.count ?? 0, median: l.stats?.median ?? null, status: l.outcome?.status ?? null })),
  };
}

export function useValuationHistory(league: string | null, fp: string | null) {
  const [rows, setRows] = useState<MercValuationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!league) return;
    mercValuations(league, fp, 50)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [league, fp]);
  useEffect(reload, [reload]);
  return { rows, error, reload };
}

/** Rule candidates for the league; promoted ones are applied beside the bundled rules. */
export function useRuleCandidates(league: string | null) {
  const [rows, setRows] = useState<MercRuleCandidateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!league) return;
    mercRuleCandidates(league)
      .then((r) => {
        setRows(r);
        setError(null);
        setPromotedRules(
          r
            .filter((c) => c.status === "promoted")
            .flatMap((c) => {
              const ev = c.evidence as { skill?: string; effect?: "positive" | "negative" } | null;
              return ev?.skill && ev.effect ? [{ candidateId: c.id, family: c.family, skill: ev.skill, effect: ev.effect, title: c.title, n: c.withCount + c.withoutCount, reviewedAt: c.reviewedAt }] : [];
            }),
        );
      })
      .catch((e) => setError(String(e)));
  }, [league]);
  useEffect(reload, [reload]);
  return { rows, error, reload };
}
