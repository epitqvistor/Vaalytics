/** Cards you obtained across recorded sessions (not the game's card list), with their history. */
import { useMemo, useState } from "react";
import type { DeckCardTotal, DivinationCard } from "@/core/ipc/commands";
import { EmptyState, Input, Modal, Panel, Select } from "@/shared/components";
import { VirtualRows } from "@/shared/views/market-ui";
import { type CardRow, cardRows, type PriceBook, type SessionView, sessionUnit } from "./analytics";
import { CardArt, dateLabel, Money } from "./ui";

type Sort = "value" | "qty" | "name" | "recent" | "unit";

export function CollectionTab({ views, allTotals, book, cards, onOpenSession }: { views: readonly SessionView[]; allTotals: readonly DeckCardTotal[]; book: PriceBook | null; cards: readonly DivinationCard[]; onOpenSession: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("value");
  const [open, setOpen] = useState<CardRow | null>(null);
  const rows = useMemo(() => cardRows(views, allTotals, book), [views, allTotals, book]);
  const meta = useMemo(() => new Map(cards.map((c) => [c.name, c])), [cards]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = rows.filter((r) => !n || r.card.toLowerCase().includes(n) || (meta.get(r.card)?.reward ?? "").toLowerCase().includes(n));
    const by: Record<Sort, (a: CardRow, b: CardRow) => number> = {
      value: (a, b) => b.value - a.value,
      qty: (a, b) => b.qty - a.qty,
      name: (a, b) => a.card.localeCompare(b.card),
      recent: (a, b) => b.lastAt - a.lastAt,
      unit: (a, b) => (b.unit ?? -1) - (a.unit ?? -1),
    };
    return list.sort(by[sort]);
  }, [rows, q, sort, meta]);

  if (rows.length === 0) {
    return (
      <Panel>
        <EmptyState icon="cards" title="Your collection is empty" body="Cards appear here once they're confirmed in a session. This is what you obtained — not the full card list." className="py-16" />
      </Panel>
    );
  }
  const totalQty = rows.reduce((a, r) => a + r.qty, 0);
  return (
    <Panel flush>
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <Input size="sm" icon="search" placeholder="Search card or reward" value={q} onChange={(e) => setQ(e.target.value)} containerClassName="w-64" aria-label="Search cards" />
        <Select
          size="sm"
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: "value", label: "Total value" },
            { value: "unit", label: "Unit value" },
            { value: "qty", label: "Quantity" },
            { value: "recent", label: "Last obtained" },
            { value: "name", label: "Name" },
          ]}
          className="w-40"
        />
        <span className="mb-1.5 ml-auto text-xs text-fg-muted">
          {rows.length} different cards · {totalQty} confirmed in total
        </span>
      </div>
      <VirtualRows
        rows={shown}
        rowHeight={48}
        getKey={(r) => r.card}
        className="max-h-[640px]"
        header={
          <div className="grid h-9 grid-cols-[minmax(220px,1.3fr)_minmax(140px,1fr)_60px_100px_110px_80px_110px] items-center gap-3 border-b border-line bg-bg-2/95 px-4 text-xs text-fg-subtle">
            <span>Card</span>
            <span>Reward</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Avg. unit</span>
            <span className="text-right">Total value</span>
            <span className="text-right">Sessions</span>
            <span className="text-right">Last obtained</span>
          </div>
        }
        renderRow={(r) => {
          const m = meta.get(r.card);
          const avg = r.qty - r.unpriced > 0 ? r.value / (r.qty - r.unpriced) : null;
          return (
            <button onClick={() => setOpen(r)} className="grid h-full w-full grid-cols-[minmax(220px,1.3fr)_minmax(140px,1fr)_60px_100px_110px_80px_110px] items-center gap-3 border-b border-line px-4 text-left text-sm hover:bg-elevated/60">
              <span className="flex min-w-0 items-center gap-2.5">
                <CardArt name={r.card} size={26} />
                <span className="truncate text-fg">{r.card}</span>
              </span>
              <span className="truncate text-xs text-fg-muted" title={m?.reward}>
                {m ? `${m.reward}${m.stackSize ? ` · set of ${m.stackSize}` : ""}` : "—"}
              </span>
              <span className="tabular text-right text-fg">{r.qty}</span>
              <span className="text-right">
                <Money value={avg} unknown="—" />
              </span>
              <span className="text-right">
                <Money value={r.qty > r.unpriced ? r.value : null} unknown="no price" />
              </span>
              <span className="tabular text-right text-fg-muted">{r.sessions}</span>
              <span className="text-right text-xs text-fg-muted">{dateLabel(r.lastAt)}</span>
            </button>
          );
        }}
      />
      <Modal open={open !== null} onClose={() => setOpen(null)} title={open?.card ?? ""} size="md" description={open ? meta.get(open.card)?.reward : undefined}>
        {open && <CardHistory row={open} views={views} allTotals={allTotals} book={book} stack={meta.get(open.card)?.stackSize ?? null} onOpenSession={(id) => (setOpen(null), onOpenSession(id))} />}
      </Modal>
    </Panel>
  );
}

function CardHistory({ row, views, allTotals, book, stack, onOpenSession }: { row: CardRow; views: readonly SessionView[]; allTotals: readonly DeckCardTotal[]; book: PriceBook | null; stack: number | null; onOpenSession: (id: number) => void }) {
  const byId = new Map(views.map((v) => [v.id, v]));
  const entries = allTotals.filter((t) => t.card === row.card && byId.has(t.sessionId)).sort((a, b) => b.lastAt - a.lastAt);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <CardArt name={row.card} size={40} />
        <div className="text-sm">
          <div className="text-fg">
            {row.qty} obtained{stack ? ` · ${Math.floor(row.qty / stack)} full set${Math.floor(row.qty / stack) === 1 ? "" : "s"} of ${stack}` : ""}
          </div>
          <div className="text-xs text-fg-muted">
            Today <Money value={row.unit} unknown="no price" /> each{row.unitSource === "manual" ? " (your price)" : ""}
          </div>
        </div>
      </div>
      <ul className="divide-y divide-line rounded-md border border-line">
        {entries.map((t) => {
          const v = byId.get(t.sessionId)!;
          const u = sessionUnit(v, t.card, book);
          return (
            <li key={t.sessionId}>
              <button className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-elevated" onClick={() => onOpenSession(t.sessionId)}>
                <span className="min-w-0 flex-1 truncate text-fg">{v.name}</span>
                <span className="text-xs text-fg-subtle">{dateLabel(t.lastAt)}</span>
                <span className="tabular w-10 text-right">× {t.qty}</span>
                <span className="w-24 text-right">
                  <Money value={u ? u.value * t.qty : null} unknown="—" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-2xs text-fg-subtle">Finished sessions use their original valuation; running ones today's price.</p>
    </div>
  );
}
