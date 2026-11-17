import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { craftingData } from "@/core/ipc/commands";
import { useMarketOverviews } from "@/core/market/hooks";
import type { WorkerIn, WorkerOut } from "./compare.worker";
import type { McIn, McOut } from "./mc.worker";
import type { McInput, McResult } from "./montecarlo";
import type { CompareInput, MethodResult, PriceTable } from "./methods";
import { CraftingIndex } from "./pool";
import type { CraftingDataResponse } from "./types";

// Loaded once per app session; Rust keeps the on-disk cache fresh (≤ 1 day).
let pending: Promise<CraftingDataResponse> | null = null;
const load = (force: boolean) => {
  if (force || !pending) pending = craftingData("poe1", force) as Promise<CraftingDataResponse>;
  pending.catch(() => (pending = null));
  return pending;
};

export function useCraftingData() {
  const [state, setState] = useState<{ res: CraftingDataResponse | null; idx: CraftingIndex | null; error: string | null; loading: boolean }>({
    res: null,
    idx: null,
    error: null,
    loading: true,
  });
  const run = (force: boolean) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    load(force)
      .then((res) => setState({ res, idx: new CraftingIndex(res.data), error: null, loading: false }))
      .catch((e) => setState((s) => ({ ...s, error: String(e), loading: false })));
  };
  useEffect(() => run(false), []);
  return { ...state, reload: () => run(true) };
}

/** poe.ninja categories the calculator prices from. */
export const PRICE_CATEGORIES = ["currency", "fossils", "resonators", "essences"] as const;

export function usePrices(league: string | null) {
  const snapshots = useMarketOverviews("poe1", league, PRICE_CATEGORIES);
  const prices = useMemo(() => {
    const t: PriceTable = {};
    for (const s of Object.values(snapshots)) for (const row of s.items) if (row.variant === null && !(row.name in t)) t[row.name] = row.value;
    return t;
  }, [snapshots]);
  return { prices, snapshots };
}

/** Debounced comparison in a worker; keeps the last result while recomputing. */
export function useComparison(idx: CraftingIndex | null, input: CompareInput | null) {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const [state, setState] = useState<{ results: MethodResult[]; busy: boolean; error: string | null }>({ results: [], busy: false, error: null });

  useEffect(() => {
    if (!idx) return;
    const w = new Worker(new URL("./compare.worker.ts", import.meta.url), { type: "module" });
    w.postMessage({ type: "init", data: idx.data } satisfies WorkerIn);
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      if (e.data.id !== seq.current) return;
      if (e.data.type === "result") setState({ results: e.data.result, busy: false, error: null });
      else setState((s) => ({ ...s, busy: false, error: (e.data as { error: string }).error }));
    };
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [idx]);

  useEffect(() => {
    if (!input || !input.goal.targets.length) {
      seq.current++;
      setState({ results: [], busy: false, error: null });
      return;
    }
    const id = ++seq.current;
    setState((s) => ({ ...s, busy: true }));
    const t = window.setTimeout(() => worker.current?.postMessage({ type: "compare", id, input } satisfies WorkerIn), 150);
    return () => window.clearTimeout(t);
  }, [input, idx]);

  return state;
}

export type McState =
  | { status: "idle" }
  | { status: "running"; fraction: number; attempts: number; hits: number; methodId: string }
  | { status: "done"; result: McResult; methodId: string }
  | { status: "error"; error: string };

/** One Monte Carlo run at a time, in its own worker. Inputs changing resets it. */
export function useMonteCarlo(idx: CraftingIndex | null, resetKey: unknown) {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const [state, setState] = useState<McState>({ status: "idle" });

  useEffect(() => {
    if (!idx) return;
    const w = new Worker(new URL("./mc.worker.ts", import.meta.url), { type: "module" });
    w.postMessage({ type: "init", data: idx.data } satisfies McIn);
    w.onmessage = (e: MessageEvent<McOut>) => {
      const m = e.data;
      if (m.id !== seq.current) return;
      setState((s) => {
        const methodId = "methodId" in s ? s.methodId : "";
        if (m.type === "progress") return { status: "running", fraction: m.fraction, attempts: m.attempts, hits: m.hits, methodId };
        if (m.type === "result") return { status: "done", result: m.result, methodId };
        return { status: "error", error: m.error };
      });
    };
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [idx]);

  useEffect(() => {
    seq.current++;
    worker.current?.postMessage({ type: "cancel" } satisfies McIn);
    setState({ status: "idle" });
  }, [resetKey]);

  const run = useCallback((input: McInput) => {
    const id = ++seq.current;
    setState({ status: "running", fraction: 0, attempts: 0, hits: 0, methodId: input.method.id });
    worker.current?.postMessage({ type: "run", id, input } satisfies McIn);
  }, []);
  const cancel = useCallback(() => {
    seq.current++;
    worker.current?.postMessage({ type: "cancel" } satisfies McIn);
    setState({ status: "idle" });
  }, []);
  return { state, run, cancel };
}
