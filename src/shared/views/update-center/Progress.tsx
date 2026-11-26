/** Live progress of a running check, and the honest report of the last one. */
import type { UpdProgress, UpdReport } from "@/core/ipc/commands";
import { Button, IconButton, Spinner } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";

export function ProgressStrip({ progress }: { progress: UpdProgress | null }) {
  if (!progress) return null;
  const { done, total } = progress;
  return (
    <div className="panel mb-4 rounded-lg px-4 py-3" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm">
        <Spinner size={14} className="text-accent" />
        <span className="font-medium text-fg">{progress.operation}</span>
        <span className="text-xs text-fg-subtle">
          {[progress.providerId, progress.game === "poe1" ? "PoE 1" : progress.game === "poe2" ? "PoE 2" : null, progress.datasetId].filter(Boolean).join(" · ")}
        </span>
        <span className="ml-auto tabular text-xs text-fg-muted">
          {done} of {total} tasks done · {total - done} pending
        </span>
      </div>
      {total > 0 && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
          {/* Real progress: completed tasks / tasks. */}
          <div className="h-full origin-left bg-accent transition-transform duration-200" style={{ transform: `scaleX(${done / total})` }} />
        </div>
      )}
      {progress.errors.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-danger">
          {progress.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReportBanner({ report, labelOf, onDismiss, onReview }: { report: UpdReport; labelOf: (id: string) => string; onDismiss: () => void; onReview: () => void }) {
  const tone = report.status === "ok" ? "border-success/25" : report.status === "partial" ? "border-warning/30" : "border-danger/30";
  const icon = report.status === "ok" ? "success" : report.status === "partial" ? "warning" : "error";
  const title =
    report.status === "ok"
      ? `${report.kind === "check" ? "Check" : "Synchronisation"} finished — ${report.tasks === 1 ? "the task" : `all ${report.tasks} tasks`} succeeded`
      : report.status === "partial"
        ? `Partly finished — ${report.succeeded} of ${report.tasks} tasks succeeded, ${report.failures.length} failed`
        : `Failed — none of the ${report.tasks} tasks succeeded`;
  const review = report.staged.filter((s) => !report.applied.some((a) => a.datasetId === s.datasetId));
  return (
    <div className={cn("panel mb-4 rounded-lg border px-4 py-3", tone)}>
      <div className="flex items-start gap-3">
        <Icon name={icon} size={16} className={report.status === "ok" ? "text-success" : report.status === "partial" ? "text-warning" : "text-danger"} />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-fg">{title}</p>
          <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
            {report.applied.map((a) => (
              <li key={`a${a.datasetId}`}>Applied: {labelOf(a.datasetId)}</li>
            ))}
            {review.map((s) => (
              <li key={`s${s.datasetId}`}>
                Waiting for review: {labelOf(s.datasetId)} — {s.summary}
                {s.needsReview ? " (needs manual review)" : ""}
              </li>
            ))}
            {report.unchanged.length > 0 && <li>No changes: {report.unchanged.map(labelOf).join(", ")}</li>}
            {report.newArticles > 0 && <li>{report.newArticles} new official article(s); {report.processedArticles} analysed</li>}
            {report.failures.map((f, i) => (
              <li key={`f${i}`} className="text-danger">
                {f.providerId}
                {f.datasetId ? ` · ${labelOf(f.datasetId)}` : ""} — {f.operation} failed: {f.error}.{" "}
                {f.existingDataUsable ? "Installed data stays in use." : "No installed data yet."} {f.retryable ? "Retry later." : "Retrying won't help until the source or Vaalytics changes."}
              </li>
            ))}
          </ul>
        </div>
        {review.length > 0 && (
          <Button size="sm" variant="secondary" onClick={onReview}>
            Review
          </Button>
        )}
        <IconButton icon="close" label="Dismiss" onClick={onDismiss} />
      </div>
    </div>
  );
}
