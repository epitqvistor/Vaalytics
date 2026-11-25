/** Item library: search, filters, sorting, selection with bulk actions, virtualised rows. */
import { useMemo, useRef, useState, type UIEvent } from "react";
import { lootAssignMap, lootDelete, lootExport, lootRevalue, type LootQuery, type LootSort, type LootValueStatus } from "@/core/ipc/commands";
import { Button, Checkbox, EmptyState, Input, Modal, Panel, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { useSessionHistory } from "../session-intelligence/hooks";
import { useLootItems, useLootMaps } from "./hooks";
import { CATEGORY_LABEL, categoryLabel, displayName, mapName, quantityOf, VALUE_STATUS_LABEL } from "./stats";
import { fmtDateTime, fmtWhen, ItemIcon, PriceSource, ValueCell } from "./ui";

const GAME = "poe2" as const;
const ROW = 52;
const VIEW_ROWS = 12;
const ALL = "all";
const UNPRICED = "unpriced";

const SORTS: { value: LootSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "value_desc", label: "Highest value" },
  { value: "quantity", label: "Quantity" },
  { value: "category", label: "Category" },
  { value: "value_asc", label: "Lowest value" },
  { value: "oldest", label: "Oldest" },
];
const VALUE_FILTERS = [
  { value: ALL, label: "Any value" },
  { value: UNPRICED, label: "Unpriced" },
  ...Object.entries(VALUE_STATUS_LABEL).map(([value, label]) => ({ value, label })),
];

const dateToUnix = (v: string, plusDays = 0) => {
  const [y, m, d] = v.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d + plusDays).getTime() / 1000 : null;
};
const num = (v: string) => (v.trim() !== "" && Number(v) >= 0 ? Number(v) : null);

export function LibraryTab({ onOpen }: { onOpen: (id: number) => void }) {
  const notify = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [value, setValue] = useState(ALL);
  const [sort, setSort] = useState<LootSort>("newest");
  const [more, setMore] = useState(false);
  const [session, setSession] = useState(ALL);
  const [map, setMap] = useState(ALL);
  const [minV, setMinV] = useState("");
  const [maxV, setMaxV] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [verified, setVerified] = useState(false);
  const query = useMemo<LootQuery>(
    () => ({
      search: search.trim() || null,
      category: category === ALL ? null : category,
      valueStatus: value === ALL || value === UNPRICED ? null : (value as LootValueStatus),
      unpricedOnly: value === UNPRICED,
      sessionId: session === ALL ? null : Number(session),
      mapRunId: map === ALL ? null : Number(map),
      minValue: num(minV),
      maxValue: num(maxV),
      from: from ? dateToUnix(from) : null,
      to: to ? dateToUnix(to, 1) : null,
      favoritesOnly: favorites,
      verifiedOnly: verified,
      sort,
      limit: 5000,
    }),
    [search, category, value, session, map, minV, maxV, from, to, favorites, verified, sort],
  );
  const extraFilters = [session !== ALL, map !== ALL, minV !== "", maxV !== "", from !== "", to !== "", favorites, verified].filter(Boolean).length;
  const list = useLootItems(query);
  const sessions = useSessionHistory(GAME, { sort: "newest", limit: 100 });
  const maps = useLootMaps(null, 100);
  const mapOptions = (maps.data ?? []).map((m) => ({ value: String(m.id), label: `#${String(m.ordinal).padStart(3, "0")} ${mapName(m)} · ${fmtDateTime(m.startedAt)}` }));
  const rows = list.data ?? [];
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const first = Math.max(0, Math.floor(scroll / ROW) - 4);
  const visible = rows.slice(first, first + VIEW_ROWS + 8);
  const chosen = rows.filter((r) => selected.has(r.id));
  const now = Date.now();

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
  const clearFilters = () => {
    setSession(ALL);
    setMap(ALL);
    setMinV("");
    setMaxV("");
    setFrom("");
    setTo("");
    setFavorites(false);
    setVerified(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 rounded-lg p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Search" icon="search" placeholder="Name, base type or modifier" value={search} onChange={(e) => setSearch(e.target.value.slice(0, 80))} containerClassName="w-60" />
          <Select label="Category" value={category} onChange={setCategory} options={[{ value: ALL, label: "All categories" }, ...Object.entries(CATEGORY_LABEL).map(([v, label]) => ({ value: v, label }))]} className="w-44" />
          <Select label="Value" value={value} onChange={setValue} options={VALUE_FILTERS} className="w-44" />
          <Select label="Sort" value={sort} onChange={setSort} options={SORTS} className="w-36" />
          <Button variant={more || extraFilters ? "secondary" : "ghost"} icon="sliders" onClick={() => setMore((v) => !v)} aria-expanded={more}>
            Filters{extraFilters ? ` · ${extraFilters}` : ""}
          </Button>
        </div>
        {more && (
          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
            <Input label="Min value" type="number" min={0} value={minV} onChange={(e) => setMinV(e.target.value)} suffix="ex" containerClassName="w-28" />
            <Input label="Max value" type="number" min={0} value={maxV} onChange={(e) => setMaxV(e.target.value)} suffix="ex" containerClassName="w-28" />
            <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} containerClassName="w-40" />
            <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} containerClassName="w-40" />
            <Select
              label="Session"
              value={session}
              onChange={setSession}
              options={[{ value: ALL, label: "All sessions" }, ...(sessions.data ?? []).map((s) => ({ value: String(s.id), label: `#${s.id} · ${fmtDateTime(s.startedAt)}` }))]}
              className="w-52"
            />
            <Select label="Map" value={map} onChange={setMap} options={[{ value: ALL, label: "All maps" }, ...mapOptions]} className="w-64" />
            <div className="flex items-center gap-4 pb-1.5">
              <Checkbox label="Verified" checked={verified} onChange={setVerified} />
              <Checkbox label="Favourites" checked={favorites} onChange={setFavorites} />
            </div>
            {extraFilters > 0 && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>

      <Panel
        flush
        title={
          <span className="flex items-center gap-2">
            Items <span className="text-xs font-normal text-fg-subtle">{rows.length.toLocaleString("en-GB")}</span>
          </span>
        }
        actions={
          <>
            <span className="mr-1 hidden text-fg-subtle md:inline">{chosen.length ? `${chosen.length} selected` : "Export all, or select items for more actions"}</span>
            <Button size="sm" variant="ghost" icon="refresh" disabled={chosen.length === 0 || chosen.length > 500} onClick={() => run(() => lootRevalue(GAME, chosen.map((c) => c.id)), "Prices rechecked")}>
              Recheck
            </Button>
            <Button size="sm" variant="ghost" icon="map" disabled={chosen.length === 0} onClick={() => setAssignTo("")}>
              Assign map
            </Button>
            <Button size="sm" variant="ghost" icon="download" onClick={() => run(() => lootExport(GAME, chosen.map((c) => c.id), "csv"), "Export finished")}>
              CSV
            </Button>
            <Button size="sm" variant="ghost" icon="download" onClick={() => run(() => lootExport(GAME, chosen.map((c) => c.id), "json"), "Export finished")}>
              JSON
            </Button>
            <Button size="sm" variant="ghost" icon="trash" disabled={chosen.length === 0} onClick={() => setConfirm(true)} className="hover:text-danger">
              Delete
            </Button>
          </>
        }
      >
        {list.error ? (
          <EmptyState icon="error" title="Couldn't load items" body={list.error} />
        ) : list.data === null ? (
          <EmptyState icon="journal" title="Loading…" loading />
        ) : rows.length === 0 ? (
          <EmptyState icon="journal" title="No items" body="Nothing matches these filters, or nothing has been captured yet." />
        ) : (
          <div role="table" className="text-sm">
            <div role="row" className="well grid h-8 grid-cols-[28px_36px_minmax(0,1.7fr)_minmax(0,0.8fr)_130px_minmax(0,1fr)] items-center gap-3 border-b border-line px-4 text-2xs text-fg-subtle">
              <Checkbox label={<span className="sr-only">Select all</span>} checked={selected.size > 0 && selected.size === rows.length} onChange={(on) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set())} />
              <span />
              <span>Item</span>
              <span>Category</span>
              <span className="text-right">Value</span>
              <span>Captured</span>
            </div>
            <div ref={box} className="overflow-y-auto" style={{ height: Math.min(rows.length, VIEW_ROWS) * ROW }} onScroll={(e: UIEvent<HTMLDivElement>) => setScroll(e.currentTarget.scrollTop)}>
              <div style={{ height: rows.length * ROW, position: "relative" }}>
                {visible.map((i, k) => (
                  <div
                    key={i.id}
                    role="row"
                    className={cn(
                      "absolute inset-x-0 grid grid-cols-[28px_36px_minmax(0,1.7fr)_minmax(0,0.8fr)_130px_minmax(0,1fr)] items-center gap-3 border-b border-line px-4 transition-colors duration-150 hover:bg-white/[0.025]",
                      selected.has(i.id) && "bg-accent-soft/40",
                    )}
                    style={{ top: (first + k) * ROW, height: ROW }}
                  >
                    <Checkbox label={<span className="sr-only">Select {displayName(i)}</span>} checked={selected.has(i.id)} onChange={(on) => toggle(i.id, on)} />
                    <ItemIcon item={i} size={36} />
                    <button type="button" onClick={() => onOpen(i.id)} className="group min-w-0 text-left">
                      <span className="flex items-center gap-1.5 truncate text-fg group-hover:text-accent-2">
                        <span className="truncate">{displayName(i)}</span>
                        {quantityOf(i) > 1 && <span className="tabular shrink-0 text-fg-muted">×{quantityOf(i)}</span>}
                        {i.verified && <Icon name="check" size={12} className="shrink-0 text-success" aria-label="Verified" />}
                        {i.favorite && <Icon name="star" size={11} className="shrink-0 text-accent" aria-label="Favourite" />}
                        {(i.originalCategory || i.originalStackSize) && <span className="shrink-0 text-2xs text-warning/80">corrected</span>}
                      </span>
                      <span className="block truncate text-2xs text-fg-subtle">
                        {i.itemName ? `${i.baseType} · ` : ""}
                        {i.rarity}
                        {i.itemLevel ? ` · iLvl ${i.itemLevel}` : ""}
                      </span>
                    </button>
                    <span className="truncate text-xs text-fg-muted">{categoryLabel(i.category)}</span>
                    <span className="flex flex-col items-end">
                      <ValueCell item={i} />
                      <PriceSource item={i} />
                    </span>
                    <span className="min-w-0">
                      <span className="tabular block truncate text-xs text-fg-muted">
                        {fmtWhen(i.lastCapturedAt, now)}
                        {i.captureCount > 1 && <span className="text-fg-subtle"> · copied ×{i.captureCount}</span>}
                      </span>
                      <span className="block truncate text-2xs text-fg-subtle">{i.mapRunId ? `Map record #${i.mapRunId}${i.mapAssignment === "user" ? " (yours)" : ""}` : (i.captureAreaName ?? "no session")}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Modal
        open={assignTo !== null}
        onClose={() => setAssignTo(null)}
        size="sm"
        title={`Assign ${chosen.length} item${chosen.length === 1 ? "" : "s"} to a map`}
        description="Use this for copies made outside the map (e.g. in the hideout afterwards). Marked as your assignment."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssignTo(null)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => run(() => lootAssignMap(GAME, chosen.map((c) => c.id), null), "Removed from their map").then(() => setAssignTo(null))}
            >
              Remove from map
            </Button>
            <Button
              variant="primary"
              disabled={!assignTo}
              onClick={() => run(() => lootAssignMap(GAME, chosen.map((c) => c.id), Number(assignTo)), "Assigned").then(() => setAssignTo(null))}
            >
              Assign
            </Button>
          </>
        }
      >
        {mapOptions.length === 0 ? (
          <p className="text-xs text-fg-muted">No map records yet.</p>
        ) : (
          <Select label="Map" value={assignTo ?? ""} onChange={setAssignTo} options={[{ value: "", label: "Choose a map…" }, ...mapOptions]} className="w-full" />
        )}
      </Modal>

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
