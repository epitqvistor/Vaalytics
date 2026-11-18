/** Item library: search (name, base type, modifier), filters, sorting, selection, virtualised table. */
import { useMemo, useRef, useState, type UIEvent } from "react";
import { lootDelete, lootExport, lootRevalue, type LootQuery, type LootSort, type LootValueStatus } from "@/core/ipc/commands";
import { Button, Checkbox, EmptyState, Input, Modal, Panel, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { useSessionHistory } from "../session-intelligence/hooks";
import { useLootItems } from "./hooks";
import { CATEGORY_LABEL, categoryLabel, displayName, VALUE_STATUS_LABEL } from "./stats";
import { fmtDateTime, ValueCell } from "./ui";

const GAME = "poe2" as const;
const ROW = 44;
const VIEW_ROWS = 14;
const ALL = "all";

const SORTS: { value: LootSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "value_desc", label: "Highest value" },
  { value: "value_asc", label: "Lowest value" },
  { value: "category", label: "Category" },
];
const RARITIES = ["Normal", "Magic", "Rare", "Unique", "Currency", "Gem"];
const ORIGIN_LABEL = { unknown: "Unknown", user_confirmed_drop: "Confirmed drop", user_not_a_drop: "Not a drop" } as const;

const dateToUnix = (v: string, plusDays = 0) => {
  const [y, m, d] = v.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d + plusDays).getTime() / 1000 : null;
};

export function LibraryTab({ onOpen }: { onOpen: (id: number) => void }) {
  const notify = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [rarity, setRarity] = useState(ALL);
  const [valueStatus, setValueStatus] = useState(ALL);
  const [session, setSession] = useState(ALL);
  const [minV, setMinV] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [sort, setSort] = useState<LootSort>("newest");
  const query = useMemo<LootQuery>(
    () => ({
      search: search.trim() || null,
      category: category === ALL ? null : category,
      rarity: rarity === ALL ? null : rarity,
      valueStatus: valueStatus === ALL ? null : (valueStatus as LootValueStatus),
      sessionId: session === ALL ? null : Number(session),
      minValue: minV.trim() !== "" && Number(minV) >= 0 ? Number(minV) : null,
      from: from ? dateToUnix(from) : null,
      to: to ? dateToUnix(to, 1) : null,
      favoritesOnly: favorites,
      sort,
      limit: 5000,
    }),
    [search, category, rarity, valueStatus, session, minV, from, to, favorites, sort],
  );
  const list = useLootItems(query);
  const sessions = useSessionHistory(GAME, { sort: "newest", limit: 100 });
  const rows = list.data ?? [];
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [scroll, setScroll] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const first = Math.max(0, Math.floor(scroll / ROW) - 4);
  const visible = rows.slice(first, first + VIEW_ROWS + 8);
  const chosen = rows.filter((r) => selected.has(r.id));

  const toggle = (id: number, on: boolean) =>
    setSelected((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const run = async (f: () => Promise<unknown>, ok: string) => {
    try {
      await f();
      notify("success", ok);
      list.reload();
    } catch (e) {
      notify("warning", "That didn't work", String(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Search" icon="search" placeholder="Name, base type or modifier" value={search} onChange={(e) => setSearch(e.target.value.slice(0, 80))} containerClassName="w-64" />
        <Select label="Category" value={category} onChange={setCategory} options={[{ value: ALL, label: "All categories" }, ...Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))]} className="w-44" />
        <Select label="Rarity" value={rarity} onChange={setRarity} options={[{ value: ALL, label: "All rarities" }, ...RARITIES.map((r) => ({ value: r, label: r }))]} className="w-36" />
        <Select label="Value" value={valueStatus} onChange={setValueStatus} options={[{ value: ALL, label: "Any value status" }, ...Object.entries(VALUE_STATUS_LABEL).map(([value, label]) => ({ value, label }))]} className="w-52" />
        <Input label="Min value" type="number" min={0} value={minV} onChange={(e) => setMinV(e.target.value)} suffix="ex" containerClassName="w-28" />
        <Select
          label="Session"
          value={session}
          onChange={setSession}
          options={[{ value: ALL, label: "All sessions" }, ...(sessions.data ?? []).map((s) => ({ value: String(s.id), label: `#${s.id} · ${fmtDateTime(s.startedAt)}` }))]}
          className="w-52"
        />
        <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} containerClassName="w-40" />
        <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} containerClassName="w-40" />
        <Select label="Sort" value={sort} onChange={setSort} options={SORTS} className="w-40" />
        <div className="pb-1.5">
          <Checkbox label="Favourites" checked={favorites} onChange={setFavorites} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-subtle">{chosen.length ? `${chosen.length} selected` : "Actions apply to the selection, or export everything when nothing is selected."}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon="refresh" disabled={chosen.length === 0 || chosen.length > 500} onClick={() => run(() => lootRevalue(GAME, chosen.map((c) => c.id)), "Prices rechecked")}>
            Recheck prices
          </Button>
          <Button size="sm" variant="secondary" icon="download" onClick={() => run(() => lootExport(GAME, chosen.map((c) => c.id), "csv"), "Export finished")}>
            CSV
          </Button>
          <Button size="sm" variant="secondary" icon="download" onClick={() => run(() => lootExport(GAME, chosen.map((c) => c.id), "json"), "Export finished")}>
            JSON
          </Button>
          <Button size="sm" variant="danger" icon="trash" disabled={chosen.length === 0} onClick={() => setConfirm(true)}>
            Delete
          </Button>
        </div>
      </div>

      <Panel flush title="Items" actions={<span>{rows.length} shown</span>}>
        {list.error ? (
          <EmptyState icon="error" title="Couldn't load items" body={list.error} />
        ) : list.data === null ? (
          <EmptyState icon="journal" title="Loading…" loading />
        ) : rows.length === 0 ? (
          <EmptyState icon="journal" title="No items" body="Nothing matches, or nothing has been captured yet." />
        ) : (
          <div role="table" className="text-sm">
            <div role="row" className="grid h-9 grid-cols-[32px_28px_minmax(0,1.6fr)_110px_70px_44px_130px_120px_96px] items-center gap-3 border-b border-line bg-bg-2/95 px-4 text-xs text-fg-subtle">
              <Checkbox label={<span className="sr-only">Select all</span>} checked={selected.size > 0 && selected.size === rows.length} onChange={(on) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set())} />
              <span />
              <span>Item</span>
              <span>Category</span>
              <span>Rarity</span>
              <span className="text-right">iLvl</span>
              <span className="text-right">Value</span>
              <span>Captured</span>
              <span title="Whether the item is known to have dropped (copying it doesn't prove that)">Origin</span>
            </div>
            <div ref={box} className="overflow-y-auto" style={{ height: Math.min(rows.length, VIEW_ROWS) * ROW }} onScroll={(e: UIEvent<HTMLDivElement>) => setScroll(e.currentTarget.scrollTop)}>
              <div style={{ height: rows.length * ROW, position: "relative" }}>
                {visible.map((i, k) => (
                  <div
                    key={i.id}
                    role="row"
                    className="absolute inset-x-0 grid grid-cols-[32px_28px_minmax(0,1.6fr)_110px_70px_44px_130px_120px_96px] items-center gap-3 border-b border-line px-4 hover:bg-white/[0.02]"
                    style={{ top: (first + k) * ROW, height: ROW }}
                  >
                    <Checkbox label={<span className="sr-only">Select {displayName(i)}</span>} checked={selected.has(i.id)} onChange={(on) => toggle(i.id, on)} />
                    <span className="flex size-6 items-center justify-center">{i.icon ? <img src={i.icon} alt="" className="size-6 object-contain" loading="lazy" /> : <Icon name="journal" size={14} className="text-fg-subtle" />}</span>
                    <button type="button" onClick={() => onOpen(i.id)} className="min-w-0 text-left hover:text-accent-2">
                      <span className="block truncate text-fg">
                        {displayName(i)}
                        {i.stackSize && i.stackSize > 1 && <span className="text-fg-subtle"> ×{i.stackSize}</span>}
                        {i.favorite && <Icon name="star" size={11} className="ml-1 inline text-accent" />}
                      </span>
                      {i.itemName && <span className="block truncate text-2xs text-fg-subtle">{i.baseType}</span>}
                    </button>
                    <span className="truncate text-xs text-fg-muted">{categoryLabel(i.category)}</span>
                    <span className="text-xs text-fg-muted">{i.rarity}</span>
                    <span className="tabular text-right text-xs text-fg-muted">{i.itemLevel ?? "—"}</span>
                    <span className="text-right">
                      <ValueCell item={i} />
                    </span>
                    <span className="tabular text-xs text-fg-muted" title={i.sessionId !== null ? `Session #${i.sessionId}` : "No session"}>
                      {fmtDateTime(i.capturedAt)}
                      {i.captureCount > 1 && <span className="text-fg-subtle"> ×{i.captureCount}</span>}
                    </span>
                    <span className="truncate text-2xs text-fg-subtle">{ORIGIN_LABEL[i.originStatus]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title={`Delete ${chosen.length} item${chosen.length === 1 ? "" : "s"}?`}
        description="Their captured text and valuation history are removed from this PC. This can't be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" icon="trash" onClick={() => run(() => lootDelete(GAME, chosen.map((c) => c.id)), "Items deleted").then(() => (setSelected(new Set()), setConfirm(false)))}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}
