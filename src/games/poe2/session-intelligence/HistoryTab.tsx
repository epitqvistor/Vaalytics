/** Session history: search, date filter, sort, details, compare two, delete, export. */
import { useMemo, useState } from "react";
import { sessionDelete, sessionExport, type SessionSort, type SessionSummary } from "@/core/ipc/commands";
import { Button, Checkbox, EmptyState, Input, Modal, Panel, Select, useToast } from "@/shared/components";
import { useSessionDetail, useSessionHistory } from "./hooks";
import { compareSessions, dur, fmtDateTime, formatMetric, perHour } from "./stats";
import { MapRunsTable, MetricTable, SessionFigures, SessionHeading, TimeBreakdown, VersusPrevious } from "./ui";

const GAME = "poe2" as const;
const SORTS: { value: SessionSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "longest", label: "Longest" },
  { value: "shortest", label: "Shortest" },
  { value: "most_maps", label: "Most maps" },
  { value: "fewest_maps", label: "Fewest maps" },
];

/** `YYYY-MM-DD` (local) → Unix seconds at local midnight. */
const dateToUnix = (v: string, plusDays = 0) => {
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d + plusDays).getTime() / 1000;
};

export function HistoryTab({ openId, onOpen }: { openId: number | null; onOpen: (id: number | null) => void }) {
  const notify = useToast();
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<SessionSort>("newest");
  const query = useMemo(() => ({ search: search.trim() || null, from: from ? dateToUnix(from) : null, to: to ? dateToUnix(to, 1) : null, sort, limit: 1000 }), [search, from, to, sort]);
  const list = useSessionHistory(GAME, query);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [comparing, setComparing] = useState(false);
  const rows = list.data ?? [];
  const chosen = rows.filter((s) => selected.has(s.id));
  const deletable = chosen.filter((s) => s.status === "completed");

  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const doDelete = async () => {
    try {
      const n = await sessionDelete(GAME, deletable.map((s) => s.id));
      notify("success", `Deleted ${n} session${n === 1 ? "" : "s"}`);
      setSelected(new Set());
      setConfirmDelete(false);
      list.reload();
    } catch (e) {
      notify("warning", "Couldn't delete", String(e));
    }
  };

  const doExport = async (format: "json" | "csv") => {
    try {
      const ok = await sessionExport(GAME, chosen.map((s) => s.id), format);
      if (ok) notify("success", "Sessions exported", `${chosen.length || "All"} session${chosen.length === 1 ? "" : "s"} as ${format.toUpperCase()}`);
    } catch (e) {
      notify("warning", "Couldn't export", String(e));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Search areas" icon="search" placeholder="e.g. Razed Fields" value={search} onChange={(e) => setSearch(e.target.value.slice(0, 80))} containerClassName="w-60" />
        <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} containerClassName="w-40" />
        <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} containerClassName="w-40" />
        <Select label="Sort" value={sort} onChange={setSort} options={SORTS} className="w-40" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" icon="swap" disabled={chosen.length !== 2} onClick={() => setComparing(true)} title="Select exactly two sessions">
            Compare
          </Button>
          <Button size="sm" variant="secondary" icon="download" disabled={rows.length === 0} onClick={() => doExport("csv")}>
            CSV
          </Button>
          <Button size="sm" variant="secondary" icon="download" disabled={rows.length === 0} onClick={() => doExport("json")}>
            JSON
          </Button>
          <Button size="sm" variant="danger" icon="trash" disabled={deletable.length === 0} onClick={() => setConfirmDelete(true)}>
            Delete{deletable.length ? ` (${deletable.length})` : ""}
          </Button>
        </div>
      </div>
      <p className="-mt-3 text-2xs text-fg-subtle">Export uses the selected sessions, or every session when none is selected.</p>

      <Panel flush title="Sessions" actions={<span>{rows.length} shown</span>}>
        {list.error ? (
          <EmptyState icon="error" title="Couldn't load sessions" body={list.error} />
        ) : list.data === null ? (
          <EmptyState icon="clock" title="Loading sessions…" loading />
        ) : rows.length === 0 ? (
          <EmptyState icon="clock" title="No sessions" body={search || from || to ? "Nothing matches these filters." : "Sessions are saved automatically when Path of Exile 2 closes."} />
        ) : (
          <div role="table" className="max-h-[600px] overflow-y-auto text-sm">
            <div role="row" className="sticky top-0 z-10 grid h-9 grid-cols-[32px_minmax(0,1.4fr)_90px_70px_80px_100px_70px] items-center gap-3 border-b border-line bg-bg-2/95 px-4 text-xs text-fg-subtle">
              <span>
                <Checkbox label={<span className="sr-only">Select all</span>} checked={selected.size > 0 && selected.size === rows.length} onChange={(on) => setSelected(on ? new Set(rows.map((s) => s.id)) : new Set())} />
              </span>
              <span>Started</span>
              <span className="text-right">Duration</span>
              <span className="text-right">Maps</span>
              <span className="text-right">Maps/h</span>
              <span className="text-right">Hideout+town</span>
              <span className="text-right">Deaths*</span>
            </div>
            {rows.map((s) => (
              <div key={s.id} role="row" className="grid min-h-10 grid-cols-[32px_minmax(0,1.4fr)_90px_70px_80px_100px_70px] items-center gap-3 border-b border-line px-4 last:border-b-0 hover:bg-glass">
                <span>
                  <Checkbox label={<span className="sr-only">Select session {s.id}</span>} checked={selected.has(s.id)} onChange={(on) => toggle(s.id, on)} />
                </span>
                <button type="button" onClick={() => onOpen(s.id)} className="min-w-0 truncate text-left text-fg hover:text-accent-2">
                  {fmtDateTime(s.startedAt)}
                  {s.status === "active" && <span className="ml-2 text-2xs text-success">active</span>}
                  {s.endReason === "recovered" && <span className="ml-2 text-2xs text-warning">recovered</span>}
                  {!s.logTracked && <span className="ml-2 text-2xs text-warning">no log</span>}
                </button>
                <span className="tabular text-right text-fg">{dur(s.durationSecs)}</span>
                <span className="tabular text-right text-fg">{s.logTracked ? s.mapsEntered : "—"}</span>
                <span className="tabular text-right text-fg-muted">{s.logTracked ? formatMetric(perHour(s.mapsEntered, s.durationSecs), "rate") : "—"}</span>
                <span className="tabular text-right text-fg-muted">{s.logTracked ? dur(s.hideoutSecs + s.townSecs) : "—"}</span>
                <span className="tabular text-right text-fg-muted">{s.logTracked ? s.deaths : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <SessionModal id={openId} onClose={() => onOpen(null)} />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${deletable.length} session${deletable.length === 1 ? "" : "s"}?`}
        description="Their areas, events and statistics are removed from this PC. This can't be undone. An active session can't be deleted."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" icon="trash" onClick={doDelete}>
              Delete
            </Button>
          </>
        }
      />

      {comparing && chosen.length === 2 && <CompareModal a={chosen[0]!.startedAt >= chosen[1]!.startedAt ? chosen[0]! : chosen[1]!} b={chosen[0]!.startedAt >= chosen[1]!.startedAt ? chosen[1]! : chosen[0]!} onClose={() => setComparing(false)} />}
    </div>
  );
}

function SessionModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const detail = useSessionDetail(GAME, id);
  const d = detail.data?.detail;
  return (
    <Modal open={id !== null} onClose={onClose} title="Session summary" size="lg">
      {detail.error ? (
        <EmptyState icon="error" title="Couldn't load the session" body={detail.error} />
      ) : !d ? (
        <EmptyState icon="clock" title="Loading…" loading />
      ) : (
        <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto pr-1">
          <SessionHeading s={d.summary} />
          <SessionFigures s={d.summary} />
          <section>
            <h3 className="mb-2 text-xs font-semibold text-fg">Compared with the previous session</h3>
            <VersusPrevious s={d.summary} previous={detail.data!.previous} />
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold text-fg">Time by area type</h3>
            <TimeBreakdown session={d.summary} />
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold text-fg">Maps</h3>
            <MapRunsTable runs={d.mapRuns} />
          </section>
        </div>
      )}
    </Modal>
  );
}

function CompareModal({ a, b, onClose }: { a: SessionSummary; b: SessionSummary; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Compare sessions" description="The newer session is compared with the older one." size="lg">
      <MetricTable metrics={compareSessions(a, b)} aLabel={fmtDateTime(a.startedAt)} bLabel={fmtDateTime(b.startedAt)} />
    </Modal>
  );
}
