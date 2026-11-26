/** Permanent history of checks, applied/ignored changes, rollbacks and source errors, with filters. */
import { useEffect, useState } from "react";
import type { GameId } from "@/core/game-context/games";
import { updatesHistory, type UpdEvent, type UpdEventFilter } from "@/core/ipc/commands";
import type { UpdateCenter } from "@/core/updates/hooks";
import { EmptyState, Input, Panel, Select } from "@/shared/components";
import { moduleLabel, MODULE_LABEL, stamp, StatusDot } from "./ui";

const RANGES = { all: 0, "1d": 1, "7d": 7, "30d": 30, "90d": 90 } as const;

export function HistoryTab({ uc }: { uc: UpdateCenter }) {
  const o = uc.overview!;
  const [range, setRange] = useState<keyof typeof RANGES>("30d");
  const [game, setGame] = useState<"all" | GameId>("all");
  const [module, setModule] = useState("all");
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");
  const [league, setLeague] = useState("");
  const [rows, setRows] = useState<UpdEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const f: UpdEventFilter = { limit: 1000 };
    if (RANGES[range]) f.since = Math.floor(Date.now() / 1000) - RANGES[range] * 86400;
    if (game !== "all") f.game = game;
    if (module !== "all") f.module = module;
    if (provider !== "all") f.provider = provider;
    if (status !== "all") f.status = status;
    if (league.trim()) f.league = league.trim();
    updatesHistory(f)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [range, game, module, provider, status, league, uc.revision]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Date" size="sm" value={range} onChange={setRange} options={[{ value: "1d", label: "Last 24 h" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last 90 days" }, { value: "all", label: "All time" }]} />
        <Select label="Game" size="sm" value={game} onChange={setGame} options={[{ value: "all", label: "Both games" }, { value: "poe1", label: "PoE 1" }, { value: "poe2", label: "PoE 2" }]} />
        <Select label="Module" size="sm" value={module} onChange={setModule} options={[{ value: "all", label: "All modules" }, ...Object.keys(MODULE_LABEL).map((m) => ({ value: m, label: moduleLabel(m) }))]} />
        <Select label="Source" size="sm" value={provider} onChange={setProvider} options={[{ value: "all", label: "All sources" }, ...o.sources.map((s) => ({ value: s.meta.id, label: s.meta.name }))]} />
        <Select label="Status" size="sm" value={status} onChange={setStatus} options={[{ value: "all", label: "Any status" }, { value: "ok", label: "OK" }, { value: "info", label: "Info" }, { value: "warning", label: "Warning" }, { value: "error", label: "Error" }]} />
        <Input label="League" size="sm" value={league} onChange={(e) => setLeague(e.target.value)} placeholder="any" containerClassName="w-40" />
      </div>
      {error ? (
        <EmptyState icon="error" title="Couldn't load history" body={error} />
      ) : !rows ? (
        <EmptyState icon="clock" title="Loading…" loading />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState icon="clock" title="No entries for these filters" />
        </Panel>
      ) : (
        <Panel flush>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-fg-subtle">
                <th className="px-4 py-2 font-normal">When</th>
                <th className="px-2 py-2 font-normal">Event</th>
                <th className="px-2 py-2 font-normal">What happened</th>
                <th className="px-2 py-2 font-normal">Modules</th>
                <th className="px-4 py-2 text-right font-normal">Versions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, 500).map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-4 py-1.5 text-xs whitespace-nowrap text-fg-subtle">{stamp(e.ts)}</td>
                  <td className="px-2 py-1.5 text-xs whitespace-nowrap text-fg-muted">
                    <span className="inline-flex items-center gap-2">
                      <StatusDot status={e.status} />
                      {e.kind.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-fg-muted">
                    {e.message}
                    {e.game && <span className="ml-2 text-xs text-fg-subtle">{e.game === "poe1" ? "PoE 1" : "PoE 2"}</span>}
                    {e.durationMs != null && <span className="ml-2 text-xs text-fg-subtle">{(e.durationMs / 1000).toFixed(1)} s</span>}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-fg-subtle">{e.modules.map(moduleLabel).join(", ")}</td>
                  <td className="px-4 py-1.5 text-right text-xs whitespace-nowrap text-fg-subtle">
                    {e.fromVersion || e.toVersion ? `#${e.fromVersion ?? "—"} → #${e.toVersion ?? "—"}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 500 && <p className="border-t border-line px-4 py-2 text-xs text-fg-subtle">Showing the newest 500 of {rows.length}. Narrow the filters to see older entries.</p>}
        </Panel>
      )}
    </div>
  );
}
