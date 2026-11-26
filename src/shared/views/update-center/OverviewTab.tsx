/** Overview: per-game status, pending summary, recent changes, source health, modules, analytics. */
import { useEffect, useState } from "react";
import type { GameId } from "@/core/game-context/games";
import { updatesAnalytics, updatesHistory, type UpdAnalytics, type UpdEvent } from "@/core/ipc/commands";
import type { UpdateCenter } from "@/core/updates/hooks";
import { freshness, isOutdated, moduleStatus, overviewCounts } from "@/core/updates/logic";
import { BarChart } from "@/shared/charts/BarChart";
import { Badge, Button, Panel, StatTile } from "@/shared/components";
import type { Tab } from ".";
import { FreshnessBadge, moduleLabel, StatusDot, Time } from "./ui";

export function OverviewTab({ uc, onTab, onRun, running }: { uc: UpdateCenter; onTab: (t: Tab) => void; onRun: (m: "check" | "sync") => void; running: boolean }) {
  const o = uc.overview!;
  const c = overviewCounts(o);
  const [recent, setRecent] = useState<UpdEvent[]>([]);
  const [stats, setStats] = useState<UpdAnalytics | null>(null);
  useEffect(() => {
    updatesHistory({ limit: 200 })
      .then((e) => setRecent(e.filter((x) => ["applied", "auto_applied", "rollback", "imported", "changes_detected"].includes(x.kind)).slice(0, 8)))
      .catch(() => setRecent([]));
    updatesAnalytics()
      .then(setStats)
      .catch(() => setStats(null));
  }, [uc.revision]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Last successful sync" value={<Time ts={o.lastSuccess} />} caption={o.lastAttempt ? <>last attempt <Time ts={o.lastAttempt} /></> : "no check yet"} />
        <StatTile label="Pending updates" value={c.pending} caption={c.pendingReview ? `${c.pendingReview} need your review` : "nothing waiting for review"} />
        <StatTile label="Sources" value={`${c.sourcesOk}/${c.sources}`} caption={c.sourcesFailed ? `${c.sourcesFailed} failing` : "healthy or not checked yet"} />
        <StatTile label="Outdated" value={c.outdatedDatasets} unit="datasets" caption={`${c.outdatedModules} module${c.outdatedModules === 1 ? "" : "s"} affected`} />
      </div>

      {o.lastAttempt == null && (
        <Panel>
          <div className="flex flex-wrap items-center gap-4">
            <p className="min-w-0 flex-1 text-sm text-fg-muted">
              No check has run yet. <b className="text-fg">Check for updates</b> looks at every enabled source and shows what changed; nothing is installed until you apply it.
              Scheduled game-data refreshes (once per day by default) apply safe updates automatically.
            </p>
            <Button icon="refresh" disabled={running} onClick={() => onRun("check")}>
              Check for updates
            </Button>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {(["poe1", "poe2"] as GameId[]).map((g) => (
          <GameCard key={g} uc={uc} game={g} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Recently applied and detected" actions={<Button size="sm" variant="ghost" onClick={() => onTab("history")}>History</Button>} className="lg:col-span-2" flush>
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-subtle">No changes recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <StatusDot status={e.status} />
                  <span className="min-w-0 flex-1 truncate text-fg-muted">{e.message}</span>
                  {e.modules.length > 0 && <span className="hidden truncate text-xs text-fg-subtle xl:inline">{e.modules.map(moduleLabel).join(", ")}</span>}
                  <span className="shrink-0 text-xs text-fg-subtle">
                    <Time ts={e.ts} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Source health" actions={<Button size="sm" variant="ghost" onClick={() => onTab("sources")}>Sources</Button>} flush>
          <ul className="divide-y divide-line">
            {o.sources.map((s) => (
              <li key={s.meta.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <StatusDot status={!s.state.enabled ? "unknown" : s.state.status} />
                <span className="min-w-0 flex-1 truncate text-fg-muted">{s.meta.name}</span>
                <span className="shrink-0 text-xs text-fg-subtle">{s.state.enabled ? <Time ts={s.state.lastSuccessAt} /> : "disabled"}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <ModulesPanel uc={uc} />
      {stats && <AnalyticsPanel a={stats} />}
    </div>
  );
}

function GameCard({ uc, game }: { uc: UpdateCenter; game: GameId }) {
  const o = uc.overview!;
  const ds = o.datasets.filter((d) => d.def.game === game);
  const versioned = ds.filter((d) => d.def.kind === "versioned");
  return (
    <Panel title={game === "poe1" ? "Path of Exile 1" : "Path of Exile 2"} actions={<span>League: {o.selectedLeagues[game] ?? "none selected"}</span>} flush>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-line">
          {ds.map((d) => (
            <tr key={d.def.id}>
              <td className="px-4 py-2 text-fg">{d.def.label}</td>
              <td className="px-2 py-2 text-xs text-fg-subtle">
                {d.def.kind === "versioned"
                  ? d.installed
                    ? `v ${d.installed.label} · ${d.installed.entryCount} entries`
                    : "not installed"
                  : d.def.kind === "managed"
                    ? d.market
                      ? `${d.market.items} prices · ${d.market.league}`
                      : "kept by the Crafting service"
                    : "bundled"}
              </td>
              <td className="px-2 py-2 text-right">{d.pending > 0 && <Badge tone="accent">{d.pending} pending</Badge>}</td>
              <td className="px-4 py-2 text-right">
                <FreshnessBadge f={freshness(d, o.now)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2 text-xs text-fg-subtle">
        Data version: {versioned.length ? versioned.map((d) => `${d.def.label} ${d.installed?.label ?? "—"}`).join(" · ") : "no versioned datasets"}
      </p>
    </Panel>
  );
}

function ModulesPanel({ uc }: { uc: UpdateCenter }) {
  const o = uc.overview!;
  const statuses = o.modules.map((m) => moduleStatus(m, o.datasets, o.now));
  const tone = { ok: "success", pending: "accent", stale: "warning", missing: "danger", bundled: "neutral" } as const;
  const label = { ok: "Up to date", pending: "Update pending", stale: "Stale data", missing: "Data missing", bundled: "Bundled data" } as const;
  return (
    <Panel title="Modules and their data" actions={<span>{statuses.filter(isOutdated).length} with outdated data</span>} flush>
      <div className="grid divide-line sm:grid-cols-2 xl:grid-cols-3 [&>*]:border-b [&>*]:border-line">
        {statuses.map((s) => (
          <div key={`${s.reg.game}:${s.reg.moduleId}`} className="flex items-start gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">
                {moduleLabel(s.reg.moduleId)} <span className="text-xs text-fg-subtle">{s.reg.game === "poe1" ? "PoE 1" : "PoE 2"}</span>
              </p>
              <p className="truncate text-xs text-fg-subtle" title={[...s.reg.required, ...s.reg.optional].join(", ")}>
                {s.reasons.join(" · ") || [...s.reg.required, ...s.reg.optional].map((d) => o.datasets.find((x) => x.def.id === d)?.def.label ?? d).join(", ")}
              </p>
            </div>
            <Badge tone={tone[s.state]}>{label[s.state]}</Badge>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AnalyticsPanel({ a }: { a: UpdAnalytics }) {
  if (a.runs === 0) return null;
  const days = a.activity.map(([d]) => new Date(d * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  return (
    <Panel title="Update analytics">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {[
            ["Checks run", a.runs],
            ["Succeeded", a.runsOk],
            ["Partly failed", a.runsPartial],
            ["Failed / interrupted", a.runsFailed],
            ["Changes detected", a.changesDetected],
            ["Changes applied", a.changesApplied],
            ["Changes ignored", a.changesIgnored],
            ["Rollbacks", a.rollbacks],
            ["Average duration", a.avgDurationSecs != null ? `${a.avgDurationSecs.toFixed(1)} s` : "—"],
            ["Most changed", a.byDataset[0] ? `${a.byDataset[0][0]} (${a.byDataset[0][1]})` : "—"],
          ].map(([k, v]) => (
            <div key={k as string} className="flex justify-between gap-3 border-b border-line py-1">
              <dt className="text-fg-subtle">{k}</dt>
              <dd className="tabular text-fg">{v}</dd>
            </div>
          ))}
        </dl>
        {a.activity.length > 1 ? (
          <BarChart title="Checks per day, last 30 days" values={a.activity.map(([, n]) => n)} labels={days} formatValue={(v) => `${v} check${v === 1 ? "" : "s"}`} height={150} />
        ) : (
          <p className="self-center text-xs text-fg-subtle">Activity chart appears after checks on more than one day.</p>
        )}
      </div>
    </Panel>
  );
}
