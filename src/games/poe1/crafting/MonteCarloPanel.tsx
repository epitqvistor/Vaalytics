/** Monte Carlo cost spread for one method, with a histogram of simulated crafts. */
import { useState } from "react";
import { Button, Select } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import type { McState } from "./hooks";
import type { MethodResult } from "./methods";
import type { McResult } from "./montecarlo";

const fmt = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const money = (c: number, divine: number | null) => (divine && c >= divine ? `${fmt(c / divine)} div` : `${fmt(c)}c`);

export function MonteCarloPanel({
  methods,
  state,
  onRun,
  onCancel,
  divine,
}: {
  methods: MethodResult[];
  state: McState;
  onRun: (m: MethodResult) => void;
  onCancel: () => void;
  divine: number | null;
}) {
  const runnable = methods.filter((m) => m.chance > 0);
  const [pick, setPick] = useState<string>("");
  const method = runnable.find((m) => m.id === pick) ?? runnable[0];
  if (!method) return null;
  const result = state.status === "done" && state.methodId === method.id ? state.result : null;

  return (
    <section className="panel rounded-xl">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <h2 className="text-sm font-semibold text-fg">Monte Carlo</h2>
        <span className="text-2xs text-fg-subtle">10,000 simulated crafts</span>
      </header>
      <div className="space-y-3 p-3.5">
        <div className="flex items-end gap-2">
          <Select label="Method" size="sm" value={method.id} onChange={setPick} options={runnable.map((m) => ({ value: m.id, label: m.label }))} className="min-w-0 flex-1" />
          {state.status === "running" ? (
            <Button size="sm" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" icon="refresh" onClick={() => onRun(method)}>
              Run
            </Button>
          )}
        </div>

        {state.status === "running" && (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-2" role="progressbar" aria-valuenow={Math.round(state.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${state.fraction * 100}%` }} />
            </div>
            <p className="mt-1 text-2xs text-fg-subtle">
              <span className="font-mono tabular">{state.attempts.toLocaleString("en-US")}</span> attempts ·{" "}
              <span className="font-mono tabular">{state.hits.toLocaleString("en-US")}</span> hits
            </p>
          </div>
        )}
        {state.status === "error" && <p className="text-xs text-danger">{state.error}</p>}
        {result && <McSummary r={result} divine={divine} />}
        {state.status === "idle" && (
          <p className="text-2xs leading-relaxed text-fg-subtle">
            Rolls the method with the game's weights for a few seconds, measures the success rate and shows how much a craft can cost — the spread
            behind the average.
          </p>
        )}
      </div>
    </section>
  );
}

function McSummary({ r, divine }: { r: McResult; divine: number | null }) {
  const values = r.cost ?? null;
  const rows: [string, number, number][] = (["p25", "p50", "p75", "p90"] as const).map((k) => [k.slice(1), r.tries[k], values ? values[k] : NaN]);
  const diff = r.modelChance > 0 ? r.chance / r.modelChance - 1 : 0;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md bg-bg-2/80 px-2.5 py-2">
          <dt className="text-2xs text-fg-subtle">Measured chance</dt>
          <dd className="font-mono tabular text-fg">{r.usedModel ? "no hits" : chance(r.chance)}</dd>
          <dd className="text-2xs text-fg-subtle">
            {r.hits.toLocaleString("en-US")} in {r.attempts.toLocaleString("en-US")} attempts
          </dd>
        </div>
        <div className="rounded-md bg-bg-2/80 px-2.5 py-2">
          <dt className="text-2xs text-fg-subtle">Model chance</dt>
          <dd className="font-mono tabular text-fg">{chance(r.modelChance)}</dd>
          {!r.usedModel && r.hits >= 30 && (
            <dd className={cn("text-2xs", Math.abs(diff) > 0.1 ? "text-warning" : "text-fg-subtle")}>
              {diff >= 0 ? "+" : ""}
              {(diff * 100).toFixed(1)}% vs measured
            </dd>
          )}
        </div>
      </dl>

      {r.usedModel && (
        <p className="flex gap-1.5 text-2xs text-warning">
          <Icon name="info" size={13} className="mt-px shrink-0" />
          No hits in the time budget — the spread below uses the model chance.
        </p>
      )}

      <Histogram r={r} divine={divine} />

      <table className="w-full text-xs">
        <caption className="sr-only">Cost and tries by percentile of simulated crafts</caption>
        <thead>
          <tr className="text-2xs text-fg-subtle">
            <th className="text-left font-normal">Crafts done by</th>
            <th className="text-right font-normal">Tries</th>
            <th className="text-right font-normal">Cost</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular">
          {rows.map(([p, tries, cost]) => (
            <tr key={p}>
              <td className="font-sans text-fg-muted">{p}%</td>
              <td className="text-right text-fg">{tries.toLocaleString("en-US")}</td>
              <td className="text-right text-fg">{Number.isNaN(cost) ? "no price" : money(cost, divine)}</td>
            </tr>
          ))}
          {r.cost && (
            <tr className="border-t border-line">
              <td className="font-sans text-fg-muted">Average</td>
              <td />
              <td className="text-right text-fg">{money(r.cost.mean, divine)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const chance = (p: number) => (p <= 0 ? "—" : p >= 0.01 ? `${(p * 100).toFixed(2)}%` : `1 in ${Math.round(1 / p).toLocaleString("en-US")}`);

function Histogram({ r, divine }: { r: McResult; divine: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const bins = r.histogram;
  const max = Math.max(...bins.map((b) => b.count), 1);
  const W = 300;
  const H = 96;
  const bw = W / bins.length;
  const label = (v: number) => (r.cost ? money(v, divine) : `${Math.round(v).toLocaleString("en-US")} tries`);
  const h = hover === null ? null : bins[hover]!;
  return (
    <figure className="space-y-1">
      <figcaption className="flex justify-between text-2xs text-fg-subtle">
        <span>{r.cost ? "Cost per finished craft" : "Tries per finished craft"}</span>
        <span className="font-mono tabular text-fg-muted">
          {h ? `${label(h.from)}–${label(h.to)}: ${((h.count / r.crafts) * 100).toFixed(1)}%` : "hover a bar"}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="w-full" role="img" aria-label="Histogram of simulated craft costs" onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={H} y2={H} stroke="var(--color-line-strong)" strokeWidth={1} />
        {bins.map((b, i) => {
          const bh = (b.count / max) * (H - 4);
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              {b.count > 0 && (
                <rect
                  x={i * bw + 1}
                  y={H - bh}
                  width={Math.max(1, bw - 2)}
                  height={bh}
                  rx={Math.min(2, (bw - 2) / 2)}
                  fill={hover === i ? "var(--color-accent-2)" : "var(--color-accent)"}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
            </g>
          );
        })}
        <text x={0} y={H + 11} fontSize={9} fill="var(--color-fg-subtle)">
          0
        </text>
        <text x={W} y={H + 11} fontSize={9} fill="var(--color-fg-subtle)" textAnchor="end">
          {label(bins[bins.length - 1]!.to)}+
        </text>
      </svg>
    </figure>
  );
}
