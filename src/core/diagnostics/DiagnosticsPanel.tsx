import { useCallback, useEffect, useState } from "react";
import { getDiagnostics, marketStats, type DiagnosticsSnapshot, type MarketStats } from "@/core/ipc/commands";
import { Panel } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { formatBytes, formatDuration, formatRelative } from "@/shared/utilities/format";

const REFRESH_MS = 2000;

/**
 * Samples diagnostics only while this panel is mounted and the window is
 * visible, so the diagnostics system adds no background load.
 */
export default function DiagnosticsPanel() {
  const [snap, setSnap] = useState<DiagnosticsSnapshot | null>(null);
  const [market, setMarket] = useState<MarketStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    getDiagnostics()
      .then((s) => {
        setSnap(s);
        setError(null);
      })
      .catch((e) => setError(String(e)));
    marketStats()
      .then(setMarket)
      .catch(() => setMarket(null));
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const rows: [string, string][] = snap
    ? [
        ["Version", snap.appVersion],
        ["Uptime", formatDuration(snap.uptimeSecs)],
        ["Host process memory", formatBytes(snap.hostMemoryBytes)],
        ["Host process CPU", `${snap.hostCpuPercent.toFixed(1)} %`],
        ["WebView2 processes", String(snap.webviewProcesses)],
        ["WebView2 memory", formatBytes(snap.webviewMemoryBytes)],
        ["WebView2 CPU", `${snap.webviewCpuPercent.toFixed(1)} %`],
        ["Database schema", `v${snap.dbSchemaVersion}`],
        ["Database size", formatBytes(snap.dbSizeBytes)],
      ]
    : [];
  const marketRows: [string, string][] = market
    ? [
        ["Requests this session", String(market.http.requests)],
        ["Not modified (304)", String(market.http.notModified)],
        ["Failed attempts", String(market.http.errors)],
        ["Downloaded", formatBytes(market.http.bytes)],
        ["Last request", market.http.lastRequestAt ? formatRelative(market.http.lastRequestAt * 1000) : "—"],
        ["Kept fresh in background", `${market.watchedResources} categories`],
        ["In flight", String(market.inFlight)],
      ]
    : [];

  return (
    <div className="flex flex-col gap-5">
    <Panel title="Runtime" actions={<span className="text-xs text-fg-subtle">Sampled every {REFRESH_MS / 1000}s while open</span>} flush>
      {error && (
        <p className="flex items-center gap-2 px-4 py-3.5 text-sm text-danger">
          <Icon name="error" size={14} /> {error}
        </p>
      )}
      {!error && !snap && <p className="px-4 py-3.5 text-sm text-fg-muted">Sampling…</p>}
      <dl className="divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between px-4 py-2.5 text-sm">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="tabular font-mono text-xs leading-5 text-fg" data-selectable>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
    {market && (
      <Panel title="Market data · poe.ninja" flush>
        <StatRows rows={marketRows} />
      </Panel>
    )}
    </div>
  );
}

function StatRows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between px-4 py-2.5 text-sm">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="tabular font-mono text-xs leading-5 text-fg" data-selectable>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
