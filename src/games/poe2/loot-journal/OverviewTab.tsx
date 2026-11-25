/** Overview: capture state, headline figures, recent and most valuable captures, recent map performance. */
import { useEffect, useMemo, useState } from "react";
import { lootEvents, lootResetSession, type LootCaptureEventRow, type LootCaptureStatus, type LootItem, type LootMapRun } from "@/core/ipc/commands";
import { Button, EmptyState, Panel, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { Price } from "@/shared/views/common";
import { POE2_CONFIG } from "../config";
import { useLootMapCounts, useLootMaps, useLootUpdates, useSessionReset } from "./hooks";
import { capturedSince, categoryLabel, displayName, isValued, lootTotals, mapDuration, mapName, quantityOf, startOfWeek } from "./stats";
import { fmtClock, fmtDuration, fmtWhen, ItemIcon, MapSourceTag, Metric, MetricStrip, PriceSource, ValueCell } from "./ui";

const unit = POE2_CONFIG.baseUnit;

export function OverviewTab({ items: allItems, status, onOpen }: { items: LootItem[]; status: LootCaptureStatus | null; onOpen: (id: number) => void }) {
  const [now] = useState(() => Date.now());
  // After "Reset session" the Overview starts from that moment; the full history stays in Library / Analytics.
  const resetAt = useSessionReset();
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [resetAt]);
  const since = !showAll && resetAt ? resetAt : null;
  const items = useMemo(() => (since === null ? allItems : allItems.filter((i) => i.capturedAt >= since)), [allItems, since]);
  const t = useMemo(() => lootTotals(items), [items]);
  const top = useMemo(() => items.filter(isValued).sort((a, b) => b.valueTotal! - a.valueTotal!).slice(0, 6), [items]);
  const counts = useLootMapCounts();
  const allMaps = useLootMaps(null, 300);
  const maps = useMemo(
    () => ({ ...allMaps, data: allMaps.data ? allMaps.data.filter((m) => since === null || m.startedAt >= since || m.status !== "finished").slice(0, 8) : null }),
    [allMaps, since],
  );
  const mapsSince = allMaps.data?.filter((m) => since !== null && m.startedAt >= since).length ?? 0;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const [events, setEvents] = useState<LootCaptureEventRow[]>([]);
  const loadEvents = () => {
    lootEvents("poe2", 8)
      .then(setEvents)
      .catch(() => setEvents([]));
  };
  useEffect(loadEvents, []);
  useLootUpdates(loadEvents);
  const errors = events.filter((e) => e.kind === "error");
  const open = maps.data?.find((m) => m.status !== "finished") ?? null;

  return (
    <div className="flex flex-col gap-5">
      <CaptureStrip status={status} open={open} />
      {resetAt && (
        <p className="-mt-2 flex flex-wrap items-center gap-2 px-1 text-xs text-fg-muted">
          <Icon name="refresh" size={13} className="text-accent-2" />
          {since !== null ? (
            <>
              Showing this session — since your reset at <span className="text-fg">{fmtWhen(resetAt, now)}</span>. Nothing was deleted; Library and Analytics keep the full history.
              <button type="button" className="text-accent-2 hover:underline" onClick={() => setShowAll(true)}>
                Show all history
              </button>
            </>
          ) : (
            <>
              Showing all history.
              <button type="button" className="text-accent-2 hover:underline" onClick={() => setShowAll(false)}>
                Back to this session
              </button>
            </>
          )}
        </p>
      )}

      <MetricStrip className="grid-cols-2 sm:grid-cols-4 min-[1500px]:grid-cols-8">
        <Metric label="Captured value" value={<Price amount={t.value} unit={unit} />} caption="captured items only" />
        <Metric label="Items" value={t.items} caption={`${capturedSince(items, today.getTime())} today · ${capturedSince(items, startOfWeek(now))} this week`} />
        <Metric label="Quantity" value={t.quantity.toLocaleString("en-GB")} caption="stack sizes added up" />
        <Metric label="Priced" value={t.valued} caption={t.items ? `${Math.round((t.valued / t.items) * 100)}% of items` : "—"} />
        <Metric label="Unpriced" value={t.unpriced} caption="manual value or no market data" />
        <Metric label="Average value" value={t.average !== null ? <Price amount={t.average} unit={unit} /> : "—"} caption="per priced item" />
        {since !== null ? (
          <>
            <Metric label="Maps" value={mapsSince} caption="since the reset" />
            <Metric label="Session time" value={fmtDuration(now / 1000 - since)} caption={`since ${fmtWhen(since, now)}`} />
          </>
        ) : (
          <>
            <Metric label="Maps tracked" value={counts.data?.maps ?? "—"} caption="from Session Intelligence + manual" />
            <Metric label="Sessions" value={counts.data?.sessions ?? "—"} caption="tracked game sessions" />
          </>
        )}
      </MetricStrip>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Panel title="Recent captures" flush actions={<span>newest first</span>}>
          {items.length === 0 ? (
            <EmptyState
              icon="journal"
              title={since !== null ? "Nothing captured since the reset" : "Nothing captured yet"}
              body="Hover an item in Path of Exile 2 and press Ctrl+C while Vaalytics is running — it appears here automatically."
            />
          ) : (
            <ul className="divide-y divide-line">
              {items.slice(0, 10).map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => onOpen(i.id)} className="grid w-full grid-cols-[32px_minmax(0,1fr)_auto_84px] items-center gap-3 px-4 py-2 text-left transition-colors duration-150 hover:bg-white/[0.025]">
                    <ItemIcon item={i} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-fg">
                        {displayName(i)}
                        {quantityOf(i) > 1 && <span className="tabular text-fg-muted"> ×{quantityOf(i)}</span>}
                      </span>
                      <span className="block truncate text-2xs text-fg-subtle">
                        {categoryLabel(i.category)}
                        {i.captureAreaName && ` · ${i.captureAreaName}`}
                      </span>
                    </span>
                    <span className="flex flex-col items-end">
                      <ValueCell item={i} />
                      <PriceSource item={i} />
                    </span>
                    <span className="tabular text-right text-2xs whitespace-nowrap text-fg-subtle">{fmtWhen(i.lastCapturedAt, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Most valuable captures" flush>
          {top.length === 0 ? (
            <EmptyState icon="currency" title="No priced captures yet" className="py-8" />
          ) : (
            <ul className="divide-y divide-line">
              {top.map((i, k) => (
                <li key={i.id}>
                  <button type="button" onClick={() => onOpen(i.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.025]">
                    <span className="tabular w-4 text-2xs text-fg-subtle">{k + 1}</span>
                    <ItemIcon item={i} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{displayName(i)}</span>
                      <span className="block truncate text-2xs text-fg-subtle">
                        {quantityOf(i) > 1 ? `×${quantityOf(i)} · ` : ""}
                        {fmtWhen(i.capturedAt, now)}
                      </span>
                    </span>
                    <span className="flex flex-col items-end">
                      <ValueCell item={i} strong />
                      <PriceSource item={i} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errors.length > 0 && (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-1 text-xs font-semibold text-fg">Recent capture errors</p>
              <ul className="space-y-0.5 text-2xs text-warning">
                {errors.slice(0, 3).map((e, k) => (
                  <li key={k}>
                    {fmtWhen(e.at, now)} · {e.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Recent map performance" flush actions={<span>captures assigned to each map · not total loot</span>}>
        <MapTable maps={maps.data} error={maps.error} nowMs={now} />
      </Panel>
    </div>
  );
}

/** Restarts the Loot Tracker's session counters (two clicks); nothing is deleted. */
function ResetSessionButton() {
  const notify = useToast();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <Button
      size="sm"
      variant={armed ? "secondary" : "ghost"}
      icon="refresh"
      className="ml-auto"
      title="The Loot Tracker's session time, value, captures and maps count from now. Nothing is deleted."
      onClick={() =>
        armed
          ? (setArmed(false),
            void lootResetSession("poe2", false).then(
              () => notify("success", "Session reset — counters start now"),
              (e) => notify("warning", "Couldn't reset", String(e)),
            ))
          : setArmed(true)
      }
    >
      {armed ? "Click again to reset" : "Reset session"}
    </Button>
  );
}

/** One line: capture state, last capture, the open map. */
function CaptureStrip({ status, open }: { status: LootCaptureStatus | null; open: LootMapRun | null }) {
  return (
    <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg px-4 py-2.5 text-xs">
      <span className="text-fg-muted">
        Hover an item in game and press <kbd className="rounded-xs border border-line bg-well px-1 font-mono text-[11px] text-fg">Ctrl+C</kbd> — saved here automatically.
      </span>
      <span className="text-fg-subtle">
        Last capture: <span className="text-fg-muted">{status?.lastCaptureAt ? `${status.lastItemName ?? "item"} · ${fmtWhen(status.lastCaptureAt)}` : "none in this run"}</span>
      </span>
      <ResetSessionButton />
      {open && (
        <span className="flex items-center gap-2 text-fg-muted">
          <span className="size-1.5 rounded-full bg-success" aria-hidden />
          In map: <span className="text-fg">{mapName(open)}</span>
          <MapSourceTag source={open.source} />
        </span>
      )}
      {status && !status.available && (
        <span className="flex basis-full items-center gap-1.5 text-warning">
          <Icon name="warning" size={13} /> The clipboard listener couldn't start; see the Vaalytics log.
        </span>
      )}
      {status?.lastError && (
        <span className="flex basis-full items-center gap-1.5 text-warning">
          <Icon name="warning" size={13} /> {status.lastError}
        </span>
      )}
    </div>
  );
}

export function MapTable({ maps, error, nowMs, onOpenItem }: { maps: LootMapRun[] | null; error: string | null; nowMs: number; onOpenItem?: (id: number) => void }) {
  if (error) return <EmptyState icon="error" title="Couldn't load maps" body={error} className="py-8" />;
  if (maps === null) return <EmptyState icon="map" title="Loading…" loading className="py-8" />;
  if (maps.length === 0)
    return (
      <EmptyState
        icon="map"
        title="No maps tracked yet"
        body="Maps are picked up from Session Intelligence (it reads the game's log) — or start one yourself in the Loot Tracker overlay."
        className="py-8"
      />
    );
  const nowSecs = nowMs / 1000;
  return (
    <div role="table" className="text-sm">
      <div role="row" className="well grid h-8 grid-cols-[48px_minmax(0,1.4fr)_90px_70px_70px_110px_minmax(0,1fr)] items-center gap-3 border-b border-line px-4 text-2xs text-fg-subtle">
        <span>#</span>
        <span>Map</span>
        <span className="text-right">Time</span>
        <span className="text-right">Items</span>
        <span className="text-right">Unpriced</span>
        <span className="text-right">Captured value</span>
        <span>Best capture</span>
      </div>
      {maps.map((m) => (
        <div key={m.id} role="row" className="grid min-h-10 grid-cols-[48px_minmax(0,1.4fr)_90px_70px_70px_110px_minmax(0,1fr)] items-center gap-3 border-b border-line px-4 last:border-b-0">
          <span className="tabular text-xs text-fg-subtle">{String(m.ordinal).padStart(3, "0")}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-fg">{mapName(m)}</span>
            {m.areaLevel !== null && <span className="text-2xs text-fg-subtle">lvl {m.areaLevel}</span>}
            <MapSourceTag source={m.source} />
            {m.status !== "finished" && <span className="text-2xs text-success">{m.status === "paused" ? "paused" : "now"}</span>}
          </span>
          <span className="tabular text-right text-xs text-fg-muted" title={fmtDuration(mapDuration(m, nowSecs))}>
            {fmtClock(mapDuration(m, nowSecs))}
          </span>
          <span className="tabular text-right text-fg">{m.items}</span>
          <span className="tabular text-right text-xs text-fg-muted">{m.unpriced}</span>
          <span className="text-right">{m.value > 0 ? <Price amount={m.value} unit={unit} /> : <span className="text-fg-subtle">—</span>}</span>
          <span className="min-w-0 truncate text-xs text-fg-muted">
            {m.bestItemName ? (
              onOpenItem && m.bestItemId ? (
                <button type="button" className="truncate hover:text-accent-2" onClick={() => onOpenItem(m.bestItemId!)}>
                  {m.bestItemName}
                </button>
              ) : (
                m.bestItemName
              )
            ) : (
              "—"
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
