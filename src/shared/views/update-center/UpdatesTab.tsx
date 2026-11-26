/** Available updates: review staged changes with real before/after, select, apply, ignore. */
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { updatesApply, updatesChanges, updatesSetChangeStatus, type UpdChange } from "@/core/ipc/commands";
import type { UpdateCenter } from "@/core/updates/hooks";
import { CHANGE_TYPE_LABEL, changeHeadline, fieldDiff, groupChanges, type GroupBy } from "@/core/updates/logic";
import { Badge, Button, Checkbox, EmptyState, Panel, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { ConfidenceBadge, GameTag, moduleLabel, Time, ValidationBadge } from "./ui";

const PAGE = 100;

export function UpdatesTab({ uc, onRun, running }: { uc: UpdateCenter; onRun: () => void; running: boolean }) {
  const o = uc.overview!;
  const toast = useToast();
  const [show, setShow] = useState<"pending" | "ignored">("pending");
  const [changes, setChanges] = useState<UpdChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [by, setBy] = useState<GroupBy>("dataset");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [limit, setLimit] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    updatesChanges(show, undefined, 20000)
      .then((c) => {
        setChanges(c);
        setError(null);
        setSelected(new Set());
      })
      .catch((e) => setError(String(e)));
  }, [show, uc.revision]);

  const ds = (id: string) => o.datasets.find((d) => d.def.id === id);
  const labelOf = (id: string) => {
    const d = ds(id);
    return d ? `${d.def.label} · ${d.def.game === "poe1" ? "PoE 1" : "PoE 2"}` : id;
  };
  const groups = useMemo(() => groupChanges(changes ?? [], by, labelOf), [changes, by]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (ids: number[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });

  const act = async (what: "apply" | "applyAll" | "ignore" | "restore" | "reviewed", ids: number[], datasetId?: string) => {
    setBusy(true);
    try {
      if (what === "applyAll" && datasetId) {
        await updatesApply(datasetId);
        toast("success", `${labelOf(datasetId)} updated`, "The previous version is kept and can be restored under Game data.");
      } else if (what === "apply") {
        const byDs = new Map<string, number[]>();
        for (const c of (changes ?? []).filter((c) => ids.includes(c.id))) byDs.set(c.datasetId, [...(byDs.get(c.datasetId) ?? []), c.id]);
        for (const [d, list] of byDs) await updatesApply(d, list);
        toast("success", `${ids.length} change${ids.length === 1 ? "" : "s"} applied`);
      } else if (what === "ignore") {
        await updatesSetChangeStatus(ids, "ignored");
      } else if (what === "restore") {
        await updatesSetChangeStatus(ids, "pending");
      } else {
        await updatesSetChangeStatus(ids, undefined, true);
      }
      uc.bump();
    } catch (e) {
      toast("error", "Couldn't complete the action", String(e));
    } finally {
      setBusy(false);
    }
  };

  const sel = [...selected];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          label="Show"
          size="sm"
          value={show}
          onChange={setShow}
          options={[
            { value: "pending", label: "Pending" },
            { value: "ignored", label: "Ignored" },
          ]}
        />
        <Select
          label="Group by"
          size="sm"
          value={by}
          onChange={setBy}
          options={[
            { value: "dataset", label: "Dataset" },
            { value: "game", label: "Game" },
            { value: "type", label: "Change type" },
            { value: "confidence", label: "Confidence" },
            { value: "status", label: "Review status" },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          {sel.length > 0 && <span className="text-xs text-fg-muted">{sel.length} selected</span>}
          {show === "pending" ? (
            <>
              <Button size="sm" variant="secondary" disabled={!sel.length || busy} onClick={() => act("reviewed", sel)}>
                Mark reviewed
              </Button>
              <Button size="sm" variant="secondary" disabled={!sel.length || busy} onClick={() => act("ignore", sel)}>
                Ignore
              </Button>
              <Button size="sm" disabled={!sel.length || busy} onClick={() => act("apply", sel)}>
                Apply selected
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" disabled={!sel.length || busy} onClick={() => act("restore", sel)}>
              Move back to pending
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <EmptyState icon="error" title="Couldn't load updates" body={error} />
      ) : !changes ? (
        <EmptyState icon="refresh" title="Loading…" loading />
      ) : changes.length === 0 ? (
        <Panel>
          <EmptyState
            icon="success"
            title={show === "pending" ? "No updates waiting" : "Nothing ignored"}
            body={show === "pending" ? "Installed game data matches the last check. Check again to look for new data." : undefined}
            action={
              show === "pending" ? (
                <Button size="sm" icon="refresh" disabled={running} onClick={onRun}>
                  Check for updates
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        groups.map((g) => {
          const ids = g.items.map((c) => c.id);
          const all = ids.every((id) => selected.has(id));
          const single = by === "dataset" ? ds(g.key) : undefined;
          const staged = single?.staged;
          const n = limit[g.key] ?? PAGE;
          return (
            <Panel
              key={g.key}
              flush
              title={
                <span className="flex items-center gap-2">
                  <Checkbox checked={all} onChange={(on) => toggle(ids, on)} label={<span className="sr-only">Select all in {g.label}</span>} />
                  {g.label}
                  <Badge>{g.items.length}</Badge>
                </span>
              }
              actions={
                single && show === "pending" ? (
                  <>
                    {staged && <ValidationBadge v={staged.validation} />}
                    <Button size="sm" disabled={busy} onClick={() => act("applyAll", [], g.key)}>
                      Apply all {g.items.length}
                    </Button>
                  </>
                ) : undefined
              }
            >
              {staged && single && (
                <div className="border-b border-line px-4 py-2 text-xs text-fg-subtle">
                  From {single.def.providerId} · retrieved <Time ts={staged.retrievedAt} />
                  {staged.sourceVersion && <> · source version {staged.sourceVersion}</>} · {staged.entryCount} entries · affects{" "}
                  {single.consumers.map(moduleLabel).join(", ") || "no module"}
                  {staged.validationNotes.map((nt, i) => (
                    <p key={i} className={nt.level === "review" || nt.level === "failed" ? "text-warning" : undefined}>
                      {nt.message}
                    </p>
                  ))}
                </div>
              )}
              <ul className="divide-y divide-line">
                {g.items.slice(0, n).map((c) => (
                  <ChangeRow
                    key={c.id}
                    c={c}
                    datasetLabel={labelOf(c.datasetId)}
                    modules={ds(c.datasetId)?.consumers ?? []}
                    sourceUrl={ds(c.datasetId)?.staged?.sourceUrl ?? null}
                    checked={selected.has(c.id)}
                    onCheck={(on) => toggle([c.id], on)}
                    open={open === c.id}
                    onOpen={() => setOpen(open === c.id ? null : c.id)}
                  />
                ))}
              </ul>
              {g.items.length > n && (
                <div className="border-t border-line px-4 py-2">
                  <Button size="sm" variant="ghost" onClick={() => setLimit((l) => ({ ...l, [g.key]: n + PAGE }))}>
                    Show {Math.min(PAGE, g.items.length - n)} more of {g.items.length - n}
                  </Button>
                </div>
              )}
            </Panel>
          );
        })
      )}
    </div>
  );
}

function ChangeRow({
  c,
  datasetLabel,
  modules,
  sourceUrl,
  checked,
  onCheck,
  open,
  onOpen,
}: {
  c: UpdChange;
  datasetLabel: string;
  modules: string[];
  sourceUrl: string | null;
  checked: boolean;
  onCheck: (on: boolean) => void;
  open: boolean;
  onOpen: () => void;
}) {
  const rows = fieldDiff(c);
  return (
    <li className={cn("px-4 py-2", c.requiresReview && "bg-warning-soft/30")}>
      <div className="flex items-center gap-3">
        <Checkbox checked={checked} onChange={onCheck} label={<span className="sr-only">Select {c.entryName}</span>} />
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
          <Icon name={open ? "chevronDown" : "chevronRight"} size={14} className="shrink-0 text-fg-subtle" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-fg">{c.entryName}</span>
            <span className="block truncate text-xs text-fg-subtle">
              {changeHeadline(c)}
              {c.fields.length > 0 && ` · ${c.fields.join(", ")}`}
            </span>
          </span>
        </button>
        <GameTag game={c.game} />
        <Badge tone={c.changeType === "added" ? "success" : c.changeType === "removed" ? "danger" : c.changeType === "structural" ? "warning" : "neutral"}>{CHANGE_TYPE_LABEL[c.changeType]}</Badge>
        <ConfidenceBadge c={c.confidence} />
        {c.requiresReview && <Badge tone="warning">Manual review</Badge>}
        {c.reviewed && <Badge tone="info">Reviewed</Badge>}
      </div>
      {open && (
        <div className="mt-2 ml-11 space-y-2 text-xs">
          <p className="text-fg-subtle">
            {datasetLabel} · detected <Time ts={c.detectedAt} /> · affects {modules.map(moduleLabel).join(", ") || "no registered module"}
            {sourceUrl && (
              <>
                {" · "}
                <button type="button" className="text-accent-2 hover:underline" onClick={() => void openUrl(sourceUrl).catch(() => {})}>
                  open source
                </button>
              </>
            )}
          </p>
          {rows.length > 0 ? (
            <table className="w-full max-w-3xl">
              <thead>
                <tr className="text-left text-fg-subtle">
                  <th className="w-40 py-1 font-normal">Field</th>
                  <th className="py-1 font-normal">Previous</th>
                  <th className="py-1 font-normal">New</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.field} className={r.changed ? "text-fg" : "text-fg-subtle"}>
                    <td className="py-1 pr-3">{r.field}</td>
                    <td className={cn("py-1 pr-3 break-all", r.changed && "text-danger/90 line-through decoration-danger/40")}>{r.before}</td>
                    <td className={cn("py-1 break-all", r.changed && "text-success")}>{r.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-fg-subtle">No field data.</p>
          )}
        </div>
      )}
    </li>
  );
}
