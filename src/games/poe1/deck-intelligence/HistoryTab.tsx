/**
 * Session history (search, sort, filters, compare, export) and the detailed report of one session
 * (read-only once finished): summary, every card, value distribution, timeline, comparison.
 */
import { useMemo, useState } from "react";
import { type DeckEvent, decksDelete, decksSaveExport, decksUpdate } from "@/core/ipc/commands";
import { Badge, Button, EmptyState, Input, Modal, Panel, ProvenanceTag, SegmentedControl, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { formatDuration } from "@/shared/utilities/format";
import { VirtualRows } from "@/shared/views/market-ui";
import { distribution, type PriceBook, type SessionView, sessionsCsv, sessionUnit, unitPrice } from "./analytics";
import { ColumnChart, TipRows } from "./charts";
import { GAME, useDeckSession } from "./hooks";
import type { DeckPrefs } from "./prefs";
import { SessionForm } from "./SessionTab";
import { ACQUISITION_LABEL, ACQUISITIONS, CardArt, dateLabel, fmtChaos, Kpi, Money, Profit, Roi, SOURCE_LABEL, STATUS_LABEL, StatusBadge, timeLabel } from "./ui";

const errText = (e: unknown) => String(e).replace(/^Error: /, "");
type Sort = "newest" | "oldest" | "value" | "profit" | "roi" | "decks";
type Profitability = "all" | "profit" | "loss" | "even" | "unknown";

export function HistoryTab({ views, onOpen }: { views: readonly SessionView[]; onOpen: (id: number) => void }) {
  const notify = useToast();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [league, setLeague] = useState("all");
  const [acq, setAcq] = useState<string>("all");
  const [profit, setProfit] = useState<Profitability>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [compare, setCompare] = useState<number[]>([]);
  const leagues = useMemo(() => [...new Set(views.map((v) => v.league).filter((l): l is string => !!l))].sort(), [views]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = from ? Date.parse(`${from}T00:00:00`) / 1000 : null;
    const t = to ? Date.parse(`${to}T23:59:59`) / 1000 : null;
    const list = views.filter(
      (v) =>
        (!needle || v.name.toLowerCase().includes(needle) || (v.summary.notes ?? "").toLowerCase().includes(needle)) &&
        (league === "all" || v.league === league) &&
        (acq === "all" || v.acquisition === acq) &&
        (profit === "all" || (profit === "unknown" ? v.outcome === null : v.outcome === profit)) &&
        (f === null || v.at >= f) &&
        (t === null || v.at <= t),
    );
    const by: Record<Sort, (a: SessionView, b: SessionView) => number> = {
      newest: (a, b) => b.at - a.at || b.id - a.id,
      oldest: (a, b) => a.at - b.at || a.id - b.id,
      value: (a, b) => b.value - a.value,
      profit: (a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity),
      roi: (a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity),
      decks: (a, b) => b.decks - a.decks,
    };
    return list.sort(by[sort]);
  }, [views, q, league, acq, profit, from, to, sort]);
  const comparing = compare.map((id) => views.find((v) => v.id === id)).filter((v): v is SessionView => !!v);

  if (views.length === 0) {
    return (
      <Panel>
        <EmptyState icon="journal" title="No sessions yet" body="Finished and imported sessions are kept here permanently, with their original valuation." className="py-16" />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="panel flex flex-wrap items-end gap-3 rounded-lg px-4 py-3">
        <Input size="sm" icon="search" placeholder="Search name or notes" value={q} onChange={(e) => setQ(e.target.value)} containerClassName="w-56" aria-label="Search sessions" />
        <Select size="sm" label="League" value={league} onChange={setLeague} options={[{ value: "all", label: "All leagues" }, ...leagues.map((l) => ({ value: l, label: l }))]} className="w-40" />
        <Select size="sm" label="Acquisition" value={acq} onChange={setAcq} options={[{ value: "all", label: "Any" }, ...ACQUISITIONS.map((a) => ({ value: a, label: ACQUISITION_LABEL[a] }))]} className="w-40" />
        <Select
          size="sm"
          label="Result"
          value={profit}
          onChange={setProfit}
          options={[
            { value: "all", label: "Any result" },
            { value: "profit", label: "Profitable" },
            { value: "loss", label: "Unprofitable" },
            { value: "even", label: "Break-even" },
            { value: "unknown", label: "No cost entered" },
          ]}
          className="w-40"
        />
        <Input size="sm" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} containerClassName="w-36" />
        <Input size="sm" type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} containerClassName="w-36" />
        <Select
          size="sm"
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
            { value: "value", label: "Highest value" },
            { value: "profit", label: "Highest profit" },
            { value: "roi", label: "Highest ROI" },
            { value: "decks", label: "Most decks" },
          ]}
          className="w-36"
        />
        <Button
          size="sm"
          variant="ghost"
          icon="download"
          className="ml-auto"
          onClick={() =>
            decksSaveExport(GAME, `deck-sessions-${new Date().toISOString().slice(0, 10)}.csv`, sessionsCsv(shown))
              .then((ok) => ok && notify("success", "Exported", `${shown.length} sessions saved as CSV`))
              .catch((e) => notify("warning", "Export failed", errText(e)))
          }
        >
          Export CSV
        </Button>
      </section>

      {comparing.length > 0 && (
        <section className="panel flex flex-wrap items-center gap-3 rounded-lg px-4 py-2.5 text-xs">
          <span className="text-fg-muted">Compare:</span>
          {comparing.map((v) => (
            <Badge key={v.id} tone="accent">
              {v.name}
            </Badge>
          ))}
          <span className="text-fg-subtle">{comparing.length < 2 ? "pick one more session" : ""}</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setCompare([])}>
            Clear
          </Button>
        </section>
      )}
      {comparing.length === 2 && <CompareTable a={comparing[0]!} b={comparing[1]!} />}

      <Panel flush>
        <VirtualRows
          rows={shown}
          rowHeight={52}
          getKey={(v) => String(v.id)}
          className="max-h-[620px]"
          header={
            <div className="grid h-9 grid-cols-[28px_minmax(200px,1.4fr)_110px_70px_110px_100px_110px_80px] items-center gap-3 border-b border-line bg-bg-2/95 px-4 text-xs text-fg-subtle">
              <span />
              <span>Session</span>
              <span>Date</span>
              <span className="text-right">Decks</span>
              <span className="text-right">Value</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Profit</span>
              <span className="text-right">ROI</span>
            </div>
          }
          renderRow={(v) => (
            <div className="grid h-full grid-cols-[28px_minmax(200px,1.4fr)_110px_70px_110px_100px_110px_80px] items-center gap-3 border-b border-line px-4 text-sm hover:bg-elevated/60">
              <input
                type="checkbox"
                aria-label={`Compare ${v.name}`}
                checked={compare.includes(v.id)}
                onChange={(e) => setCompare((c) => (e.target.checked ? [...c.filter((x) => x !== v.id), v.id].slice(-2) : c.filter((x) => x !== v.id)))}
                className="accent-[var(--color-accent)]"
              />
              <button className="min-w-0 text-left" onClick={() => onOpen(v.id)}>
                <span className="block truncate text-fg hover:text-accent">{v.name}</span>
                <span className="block truncate text-2xs text-fg-subtle">
                  {v.league ?? "No league"} · {ACQUISITION_LABEL[v.acquisition]}
                  {v.summary.origin === "import" && " · imported"}
                  {v.summary.status !== "finished" && ` · ${v.summary.status}`}
                </span>
              </button>
              <span className="text-xs text-fg-muted">{dateLabel(v.at)}</span>
              <span className="tabular text-right text-fg">{v.decks}</span>
              <span className="text-right">
                <Money value={v.value} />
              </span>
              <span className="text-right">
                <Money value={v.cost} unknown="—" />
              </span>
              <span className="text-right">
                <Profit value={v.profit} unknown="—" />
              </span>
              <span className="text-right">
                <Roi value={v.roi} />
              </span>
            </div>
          )}
        />
        {shown.length === 0 && <EmptyState icon="search" title="No sessions match" className="py-10" />}
      </Panel>
    </div>
  );
}

function CompareTable({ a, b }: { a: SessionView; b: SessionView }) {
  const rows: [string, (v: SessionView) => React.ReactNode][] = [
    ["Date", (v) => dateLabel(v.at)],
    ["League", (v) => v.league ?? "—"],
    ["Decks", (v) => v.decks],
    ["Confirmed cards", (v) => v.cards],
    ["Card value", (v) => <Money value={v.value} />],
    ["Value per deck", (v) => <Money value={v.valuePerDeck} />],
    ["Cost", (v) => <Money value={v.cost} unknown="—" />],
    ["Profit", (v) => <Profit value={v.profit} />],
    ["ROI", (v) => <Roi value={v.roi} />],
    ["Duration", (v) => formatDuration(v.summary.activeSecs)],
  ];
  return (
    <Panel title="Comparison">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-fg-subtle">
            <th className="py-1 font-normal" />
            <th className="py-1 text-right font-medium text-fg">{a.name}</th>
            <th className="py-1 text-right font-medium text-fg">{b.name}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-1.5 text-xs text-fg-muted">{label}</td>
              <td className="tabular py-1.5 text-right">{f(a)}</td>
              <td className="tabular py-1.5 text-right">{f(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ---------- session details ----------

type CardSort = "value" | "low" | "name" | "qty" | "status";

export function SessionDetail({
  id,
  views,
  book,
  prefs,
  onBack,
  onOpen,
}: {
  id: number;
  views: readonly SessionView[];
  book: PriceBook | null;
  prefs: DeckPrefs;
  onBack: () => void;
  onOpen: (id: number) => void;
}) {
  const notify = useToast();
  const { detail, error } = useDeckSession(id);
  const view = views.find((v) => v.id === id);
  const [sort, setSort] = useState<CardSort>("value");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [compareWith, setCompareWith] = useState("");

  const lines = useMemo(() => {
    if (!detail || !view) return [];
    const m = new Map<string, { card: string; status: DeckEvent["status"]; qty: number; at: number }>();
    for (const e of detail.events) {
      if (e.status === "removed") continue;
      const key = `${e.status}:${e.card ?? e.recognizedText ?? "?"}`;
      const r = m.get(key) ?? { card: e.card ?? `“${e.recognizedText ?? "?"}”`, status: e.status, qty: 0, at: e.at };
      r.qty += 1;
      r.at = Math.max(r.at, e.at);
      m.set(key, r);
    }
    return [...m.values()].map((r) => {
      const u = r.status === "confirmed" ? sessionUnit(view, r.card, book) : unitPrice(book, r.card);
      return { ...r, unit: u?.value ?? null, source: u?.source ?? null };
    });
  }, [detail, view, book]);
  const sorted = useMemo(() => {
    const order: Record<string, number> = { confirmed: 0, review: 1, unrecognized: 2 };
    const by: Record<CardSort, (a: (typeof lines)[number], b: (typeof lines)[number]) => number> = {
      value: (a, b) => (b.unit ?? -1) * b.qty - (a.unit ?? -1) * a.qty,
      low: (a, b) => (a.unit ?? Infinity) - (b.unit ?? Infinity),
      name: (a, b) => a.card.localeCompare(b.card),
      qty: (a, b) => b.qty - a.qty,
      status: (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.card.localeCompare(b.card),
    };
    return [...lines].sort(by[sort]);
  }, [lines, sort]);
  const dist = useMemo(() => distribution(lines.filter((l) => l.status === "confirmed").map((l) => ({ qty: l.qty, unit: l.unit })), prefs.buckets), [lines, prefs.buckets]);
  const timeline = useMemo(() => {
    if (!detail) return [];
    const ev = detail.events.filter((e) => e.status === "confirmed");
    if (ev.length < 2) return [];
    const start = ev[0]!.at;
    const end = ev[ev.length - 1]!.at;
    if (end - start < 60) return [];
    const step = Math.max(60, Math.ceil((end - start) / 24 / 60) * 60);
    const buckets: { at: number; cards: number; value: number }[] = [];
    for (let t = start; t <= end; t += step) buckets.push({ at: t, cards: 0, value: 0 });
    for (const e of ev) {
      const b = buckets[Math.min(buckets.length - 1, Math.floor((e.at - start) / step))]!;
      b.cards += 1;
      b.value += (e.card && sessionUnit(view, e.card, book)?.value) || 0;
    }
    return buckets;
  }, [detail, view, book]);
  const other = views.find((v) => String(v.id) === compareWith);

  if (error) return <EmptyState icon="error" title="Couldn't load this session" body={error} action={<Button onClick={onBack}>Back</Button>} />;
  if (!detail || !view) return <EmptyState icon="refresh" loading title="Loading session…" />;
  const s = detail.session;
  const finished = s.status === "finished";

  const exportJson = () =>
    decksSaveExport(
      GAME,
      `deck-session-${s.id}.json`,
      JSON.stringify({ session: s, valuation: detail.valuation, events: detail.events.map(({ bbox: _b, ...e }) => e), exportedAt: new Date().toISOString() }, null, 2),
    )
      .then((ok) => ok && notify("success", "Session exported"))
      .catch((e) => notify("warning", "Export failed", errText(e)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" icon="chevronLeft" onClick={onBack}>
          Sessions
        </Button>
        <h2 className="truncate text-lg font-semibold text-fg">{s.name}</h2>
        {finished ? <Badge>Read-only</Badge> : <Badge tone="success">{s.status}</Badge>}
        {s.origin === "import" && <Badge tone="info">Imported from Client.txt</Badge>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" icon="sliders" onClick={() => setEditing(true)}>
            Edit details
          </Button>
          <Button size="sm" variant="ghost" icon="download" onClick={exportJson}>
            Export
          </Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Date" value={<span className="text-base">{dateLabel(view.at)}</span>} sub={`${s.league ?? "No league"} · ${ACQUISITION_LABEL[s.acquisition]}`} />
        <Kpi label="Duration" value={formatDuration(s.activeSecs)} sub={s.origin === "import" ? "first to last card" : "running time"} />
        <Kpi label="Decks / cards" value={`${view.decks} / ${view.cards}`} sub={view.review + view.unrecognized ? `${view.review + view.unrecognized} not confirmed` : "all confirmed"} />
        <Kpi
          label={finished ? "Original value" : "Live value"}
          tone="accent"
          value={<Money value={view.value} strong />}
          sub={view.currentValue !== null ? <>today <Money value={view.currentValue} /></> : view.unpricedCards ? `${view.unpricedCards} unpriced` : undefined}
        />
        <Kpi label="Profit · ROI" value={<Profit value={view.profit} />} sub={<>cost <Money value={view.cost} unknown="unknown" /> · ROI <Roi value={view.roi} /></>} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-subtle">
        {detail.valuation ? (
          <>
            <ProvenanceTag provenance={{ kind: "historical", source: "poe.ninja at finish", at: detail.valuation.valuedAt * 1000, league: detail.valuation.league ?? undefined }} />
            Original valuation from {dateLabel(detail.valuation.valuedAt)}
            {s.origin === "import" && " — prices at import time, not at the time of opening"}; “today” uses current prices.
          </>
        ) : (
          <>
            <ProvenanceTag provenance={{ kind: "estimate", source: "poe.ninja", at: book?.at ?? null }} /> Live estimate — frozen when the session is finished.
          </>
        )}
        {s.notes && <span className="ml-2 text-fg-muted">Notes: {s.notes}</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          title={`Cards · ${lines.reduce((a, l) => a + l.qty, 0)}`}
          flush
          actions={
            <SegmentedControl
              size="sm"
              label="Sort"
              value={sort}
              onChange={setSort}
              segments={[
                { value: "value", label: "Highest" },
                { value: "low", label: "Lowest" },
                { value: "name", label: "Name" },
                { value: "qty", label: "Qty" },
                { value: "status", label: "Status" },
              ]}
            />
          }
        >
          <VirtualRows
            rows={sorted}
            rowHeight={44}
            getKey={(l) => `${l.status}:${l.card}`}
            className="max-h-[520px]"
            header={
              <div className="grid h-8 grid-cols-[minmax(180px,1fr)_50px_90px_100px_110px] items-center gap-3 border-b border-line bg-bg-2/95 px-4 text-2xs text-fg-subtle">
                <span>Card</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Unit</span>
                <span className="text-right">Total</span>
                <span className="text-right">Status</span>
              </div>
            }
            renderRow={(l) => (
              <div className={cn("grid h-full grid-cols-[minmax(180px,1fr)_50px_90px_100px_110px] items-center gap-3 border-b border-line px-4 text-sm", l.status !== "confirmed" && "opacity-70")}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <CardArt name={l.card} size={24} />
                  <span className="min-w-0">
                    <span className="block truncate text-fg">{l.card}</span>
                    <span className="block truncate text-2xs text-fg-subtle">
                      {l.source === "historical" ? "valued at finish" : l.source === "manual" ? "your price" : l.source === "market" ? "poe.ninja now" : "no price"} · {timeLabel(l.at)}
                    </span>
                  </span>
                </span>
                <span className="tabular text-right">{l.qty}</span>
                <span className="text-right">
                  <Money value={l.unit} unknown="—" />
                </span>
                <span className="text-right">{l.status === "confirmed" ? <Money value={l.unit === null ? null : l.unit * l.qty} unknown="—" /> : <span className="text-2xs text-fg-subtle">not counted</span>}</span>
                <span className="text-right">
                  <StatusBadge status={l.status} />
                </span>
              </div>
            )}
          />
          {lines.length === 0 && <EmptyState icon="cards" title="No cards in this session" className="py-10" />}
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Value distribution">
            <ColumnChart
              title="Confirmed cards per value range"
              animate={prefs.animateCharts}
              height={180}
              columns={dist.buckets.map((b) => ({ key: b.label, label: b.label, value: b.cards, tooltip: <TipRows title={b.label} rows={[["Cards", String(b.cards)], ["Value", fmtChaos(b.value)]]} /> }))}
              formatTick={(v) => String(Math.round(v))}
            />
            {dist.unpriced > 0 && <p className="mt-2 text-2xs text-fg-subtle">{dist.unpriced} cards have no price.</p>}
          </Panel>
          <Panel title="Opening timeline">
            {timeline.length === 0 ? (
              <p className="text-xs text-fg-subtle">Not enough timestamps (cards spread over at least a minute) for a timeline.</p>
            ) : (
              <ColumnChart
                title="Cards over time"
                animate={prefs.animateCharts}
                height={160}
                columns={timeline.map((b) => ({ key: String(b.at), label: timeLabel(b.at).slice(0, 5), value: b.cards, tooltip: <TipRows title={timeLabel(b.at)} rows={[["Cards", String(b.cards)], ["Value", fmtChaos(b.value)]]} /> }))}
                formatTick={(v) => String(Math.round(v))}
              />
            )}
          </Panel>
          <Panel title="Compare with another session">
            <Select
              size="sm"
              label="Session"
              hideLabel
              value={compareWith}
              onChange={setCompareWith}
              options={[{ value: "", label: "Choose a session" }, ...views.filter((v) => v.id !== id).map((v) => ({ value: String(v.id), label: `${v.name} · ${dateLabel(v.at)}` }))]}
            />
            {other && (
              <div className="mt-3">
                <CompareTable a={view} b={other} />
                <Button size="sm" variant="ghost" className="mt-2" iconRight="arrowRight" onClick={() => onOpen(other.id)}>
                  Open {other.name}
                </Button>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <SessionForm
        open={editing}
        onClose={() => setEditing(false)}
        initial={{ name: s.name, league: s.league, openedOn: s.openedOn, plannedDecks: s.plannedDecks, acquisition: s.acquisition, costTotal: s.costTotal, notes: s.notes }}
        title="Edit session details"
        submitLabel="Save"
        onSubmit={(input) => decksUpdate(GAME, s.id, input)}
      />
      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this session?"
        description={`“${s.name}” and its ${detail.events.length} card entries and screenshots will be removed permanently. This can't be undone.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                decksDelete(GAME, s.id)
                  .then(() => {
                    notify("success", "Session deleted");
                    onBack();
                  })
                  .catch((e) => notify("warning", "Couldn't delete", errText(e)))
              }
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="flex gap-2 text-xs text-fg-muted">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          {STATUS_LABEL.confirmed} cards from {SOURCE_LABEL.log} or imports can be imported again later; screenshot reads can't.
        </p>
      </Modal>
    </div>
  );
}

