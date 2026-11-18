/** Diagnostics for the tracker: process, log file, reader position, counters, last error. */
import { useCallback, useEffect, useState } from "react";
import { sessionDiagnostics, type SessionDiagnostics } from "@/core/ipc/commands";
import { Button, EmptyState, Panel, useToast } from "@/shared/components";
import { formatBytes } from "@/shared/utilities/format";
import { useSessionUpdates } from "./hooks";
import { fmtDateTime } from "./stats";
import { STATE_META } from "./ui";

const GAME = "poe2" as const;

export function DiagnosticsTab() {
  const notify = useToast();
  const [d, setD] = useState<SessionDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    sessionDiagnostics(GAME)
      .then((x) => {
        setD(x);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(load, [load]);
  useSessionUpdates(GAME, load);

  if (error) return <EmptyState icon="error" title="Diagnostics unavailable" body={error} />;
  if (!d) return <EmptyState icon="info" title="Loading…" loading />;

  const t = (v: number | null) => (v === null ? "—" : fmtDateTime(v));
  const rows: [string, string][] = [
    ["State", `${STATE_META[d.state].label}${d.message ? ` — ${d.message}` : ""}`],
    ["Game process", d.processId === null ? "not running" : `${d.processName ?? "?"} (pid ${d.processId}), started ${t(d.processStartedAt)}`],
    ["Process checks", `${d.scans} (every ${d.pollSecs} s) · last ${t(d.lastScanAt)}${d.lastScanMs !== null ? ` · took ${d.lastScanMs} ms` : ""}`],
    ["Client.txt", d.logPath ?? "not set"],
    ["Chosen by", d.logPath ? (d.logManual ? "you" : "auto-discovery") : "—"],
    ["File", d.logPath ? `${d.logExists ? "exists" : "missing"} · ${d.logCheck ?? "—"}` : "—"],
    ["Size / read position", `${formatBytes(d.logSize)} / ${formatBytes(d.offset)} (byte ${d.offset})`],
    ["Unread backlog", formatBytes(d.backlogBytes)],
    ["File identity", d.fileKey ?? "—"],
    ["Last read", t(d.lastReadAt)],
    ["Last log line", t(d.lastLineAt)],
    ["Lines read (this run)", String(d.linesRead)],
    ["Events recognised", String(d.eventsParsed)],
    ["Parse errors", `${d.parseErrors}${d.skippedLongLines ? ` (incl. ${d.skippedLongLines} over-long lines)` : ""}`],
    ["Log resets (truncated/replaced)", String(d.logResets)],
    ["Active session", d.sessionId === null ? "none" : `#${d.sessionId}`],
    ["Last error", d.lastError ?? "none"],
  ];

  const copy = () =>
    navigator.clipboard
      .writeText(rows.map(([k, v]) => `${k}: ${v}`).join("\n"))
      .then(() => notify("success", "Diagnostics copied"))
      .catch(() => notify("warning", "Couldn't copy to the clipboard"));

  return (
    <Panel
      title="Tracker diagnostics"
      flush
      actions={
        <>
          <Button size="sm" variant="ghost" icon="refresh" onClick={load}>
            Refresh
          </Button>
          <Button size="sm" variant="secondary" icon="copy" onClick={copy}>
            Copy
          </Button>
        </>
      }
    >
      <dl className="divide-y divide-line text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[220px_minmax(0,1fr)] gap-4 px-4 py-2">
            <dt className="text-xs text-fg-subtle">{k}</dt>
            <dd className="tabular break-all text-xs text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line px-4 py-2.5 text-2xs text-fg-subtle">
        This view shows the full log path; the rest of the module shows only its last folders. Copying includes the path — check before sharing.
      </p>
    </Panel>
  );
}
