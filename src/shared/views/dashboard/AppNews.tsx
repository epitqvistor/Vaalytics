import { useState } from "react";
import { changelogFor } from "@/core/app/changelog";
import type { SectionId } from "@/core/game-context/sections";
import { useUpdateCenter } from "@/core/updates/hooks";
import { overviewCounts } from "@/core/updates/logic";
import { Badge, Button, EmptyState, Panel } from "@/shared/components";
import { Time } from "../update-center/ui";

/** package.json version, injected at build time by vite.config.ts (`define`). */
declare const __APP_VERSION__: string;
const APP_VERSION = __APP_VERSION__;
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtDate = (iso: string) => dateFmt.format(new Date(`${iso}T12:00:00`));
const COLLAPSED = 3;

/**
 * "What's new in Vaalytics": release notes bundled with this build
 * (src/core/app/changelog.ts) — nothing is fetched.
 */
export function WhatsNewPanel({ className }: { className?: string }) {
  const entries = changelogFor(APP_VERSION);
  const [showAll, setShowAll] = useState(false);
  const [latest, ...older] = entries;
  const shown = showAll ? older : older.slice(0, COLLAPSED);

  return (
    <Panel className={className} title="What's new in Vaalytics" meta={`v${APP_VERSION} installed`} flush>
      {!latest ? (
        <EmptyState icon="info" title="No release notes in this build" />
      ) : (
        <>
          <article className="px-4 pt-3.5 pb-4">
            <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="tabular text-sm font-semibold text-accent-2">{latest.unreleased ? "Next" : `v${latest.version}`}</span>
              <h3 className="text-sm font-semibold text-fg">{latest.title}</h3>
              <span className="text-xs text-fg-subtle">{fmtDate(latest.date)}</span>
              {latest.unreleased && <Badge tone="accent">In this build · not released yet</Badge>}
            </header>
            <ul className="mt-2.5 space-y-1.5">
              {latest.changes.map((c) => (
                <li key={c} className="grid grid-cols-[10px_minmax(0,1fr)] gap-x-2 text-sm leading-5 text-fg-muted">
                  <span aria-hidden className="mt-2 h-px w-2 bg-bronze" />
                  {c}
                </li>
              ))}
            </ul>
          </article>
          {shown.length > 0 && (
            <ul className="border-t border-line">
              {shown.map((e) => (
                <li key={e.version} className="border-b border-line px-4 py-2.5 last:border-b-0">
                  <div className="flex items-baseline gap-2.5">
                    <span className="tabular w-14 shrink-0 text-xs font-medium text-fg-muted">v{e.version}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{e.title}</span>
                    <span className="shrink-0 text-xs text-fg-subtle">{fmtDate(e.date)}</span>
                  </div>
                  {showAll && <p className="mt-1 pl-[66px] text-xs leading-relaxed text-fg-muted">{e.changes.join(" ")}</p>}
                </li>
              ))}
            </ul>
          )}
          {older.length > COLLAPSED && (
            <div className="border-t border-line px-2 py-1.5">
              <Button size="sm" variant="ghost" iconRight={showAll ? "chevronUp" : "chevronDown"} onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show less" : `All release notes (${older.length + 1})`}
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/** Game-data status from the Update Center (one read on mount, then its events — no polling). */
export function GameDataPanel({ className, onNavigate }: { className?: string; onNavigate: (id: SectionId) => void }) {
  const uc = useUpdateCenter();
  const o = uc.overview;
  const c = o ? overviewCounts(o) : null;

  return (
    <Panel
      className={className}
      title="Game data"
      meta="Update Center"
      flush
      actions={
        <Button size="sm" variant="ghost" iconRight="chevronRight" onClick={() => onNavigate("update-center")}>
          Open
        </Button>
      }
    >
      {uc.error ? (
        <EmptyState icon="error" title="Update status unavailable" body={uc.error} className="py-8" />
      ) : !o || !c ? (
        <EmptyState icon="refresh" title="Loading update status…" loading className="py-8" />
      ) : (
        <dl className="divide-y divide-line text-sm">
          <Row label="Last successful sync" value={o.lastSuccess ? <Time ts={o.lastSuccess} /> : "never"} />
          <Row
            label="Pending updates"
            value={c.pending}
            note={c.pendingReview > 0 ? <Badge tone="accent">{c.pendingReview} to review</Badge> : undefined}
          />
          <Row
            label="Outdated data"
            value={c.outdatedDatasets === 0 ? "none" : `${c.outdatedDatasets} dataset${c.outdatedDatasets === 1 ? "" : "s"}`}
            note={c.outdatedDatasets > 0 ? <Badge tone="warning">{c.outdatedModules} module{c.outdatedModules === 1 ? "" : "s"}</Badge> : undefined}
          />
          <Row label="Sources healthy" value={`${c.sourcesOk} / ${c.sources}`} note={c.sourcesFailed > 0 ? <Badge tone="danger">{c.sourcesFailed} failing</Badge> : undefined} />
          <Row label="New patch notes" value={o.articlesUnreviewed} note={o.articlesUnreviewed > 0 ? <Badge tone="info">unread</Badge> : undefined} />
        </dl>
      )}
      {uc.progress && <p className="border-t border-line px-4 py-2 text-xs text-fg-muted">Synchronising…</p>}
    </Panel>
  );
}

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex h-10 items-center gap-3 px-4">
      <dt className="min-w-0 flex-1 truncate text-fg-muted">{label}</dt>
      {note}
      <dd className="tabular text-right text-fg">{value}</dd>
    </div>
  );
}
