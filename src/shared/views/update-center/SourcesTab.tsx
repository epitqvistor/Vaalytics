/** Sources: provider metadata, health, enable/disable, connectivity test, source history. */
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { updatesHistory, updatesSetSourceEnabled, updatesTestSource, type UpdEvent } from "@/core/ipc/commands";
import type { UpdateCenter } from "@/core/updates/hooks";
import { Badge, Button, Panel, Switch, useToast } from "@/shared/components";
import { formatBytes } from "@/shared/utilities/format";
import { Field, ReliabilityBadge, stamp, StatusDot, Time } from "./ui";

const ERROR_KIND: Record<string, string> = {
  unavailable: "Source unavailable",
  timeout: "Timed out",
  auth: "Authentication refused",
  http: "HTTP error",
  rate_limited: "Rate limited",
  too_large: "Unexpected response size",
  structure: "Response structure changed",
  invalid: "Invalid data",
  blocked: "Blocked URL",
};

export function SourcesTab({ uc }: { uc: UpdateCenter }) {
  const o = uc.overview!;
  const toast = useToast();
  const [testing, setTesting] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, UpdEvent[]>>({});

  const test = (id: string) => {
    setTesting(id);
    updatesTestSource(id)
      .then((r) => {
        toast(r.ok ? "success" : "error", r.ok ? "Source reachable" : "Source check failed", `${r.message} (${(r.durationMs / 1000).toFixed(1)} s)`);
        uc.bump();
      })
      .catch((e) => toast("error", "Test failed", String(e)))
      .finally(() => setTesting(null));
  };
  const toggle = (id: string, on: boolean) =>
    updatesSetSourceEnabled(id, on)
      .then(uc.bump)
      .catch((e) => toast("error", "Couldn't change the source", String(e)));
  const showHistory = (id: string) =>
    history[id]
      ? setHistory(({ [id]: _, ...rest }) => rest)
      : updatesHistory({ provider: id, limit: 30 })
          .then((h) => setHistory((m) => ({ ...m, [id]: h })))
          .catch(() => {});

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {o.sources.map(({ meta, state, datasets }) => (
        <Panel
          key={meta.id}
          title={
            <span className="flex items-center gap-2">
              <StatusDot status={!state.enabled ? "unknown" : state.status} />
              {meta.name}
            </span>
          }
          actions={<ReliabilityBadge r={meta.reliability} />}
        >
          <dl>
            <Field label="Games">{meta.games.map((g) => (g === "poe1" ? "PoE 1" : "PoE 2")).join(", ")}</Field>
            <Field label="Provides">{meta.categories.join(", ")}</Field>
            <Field label="Datasets">{datasets.length ? datasets.join(", ") : "articles (patch notes / news)"}</Field>
            <Field label="Requests">
              <ul className="space-y-0.5">
                {meta.endpoints.map((e) => (
                  <li key={e} className="break-all">
                    {e}
                  </li>
                ))}
              </ul>
            </Field>
            {meta.via && <Field label="Fetched by">{meta.via} (no second client)</Field>}
            <Field label="Authentication">{meta.auth}</Field>
            <Field label="Rate limits">{meta.rateLimit}</Field>
            <Field label="Caching">{meta.cachePolicy}</Field>
            <Field label="Terms">{meta.terms}</Field>
            <Field label="Status">
              {!state.enabled ? (
                "Disabled — skipped by checks; installed data stays in use"
              ) : state.status === "unknown" ? (
                "Not checked yet"
              ) : (
                <>
                  {state.status === "ok" ? "Healthy" : state.status === "warning" ? "Working, with warnings" : "Failing"} · last success <Time ts={state.lastSuccessAt} /> · last attempt{" "}
                  <span title={stamp(state.lastAttemptAt)}>
                    <Time ts={state.lastAttemptAt} />
                  </span>
                  {state.lastDurationMs != null && ` · ${(state.lastDurationMs / 1000).toFixed(1)} s`}
                  {state.lastBytes ? ` · ${formatBytes(state.lastBytes)}` : ""}
                </>
              )}
            </Field>
            {state.lastError && (
              <Field label="Last error">
                <Badge tone="danger">{ERROR_KIND[state.lastErrorKind ?? ""] ?? state.lastErrorKind}</Badge> <span className="text-danger">{state.lastError}</span>
              </Field>
            )}
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Switch checked={state.enabled} onChange={(on) => toggle(meta.id, on)} label="Enabled" />
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => showHistory(meta.id)}>
                {history[meta.id] ? "Hide history" : "History"}
              </Button>
              <Button size="sm" variant="ghost" icon="external" onClick={() => void openUrl(meta.website).catch(() => {})}>
                Website
              </Button>
              <Button size="sm" variant="secondary" loading={testing === meta.id} disabled={testing != null} onClick={() => test(meta.id)}>
                Test connection
              </Button>
            </div>
          </div>
          {history[meta.id] && (
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto border-t border-line pt-2 text-xs">
              {history[meta.id]!.length === 0 && <li className="text-fg-subtle">No entries yet.</li>}
              {history[meta.id]!.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <StatusDot status={e.status} />
                  <span className="shrink-0 text-fg-subtle">{stamp(e.ts)}</span>
                  <span className="text-fg-muted">{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ))}
    </div>
  );
}
