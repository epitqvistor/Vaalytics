/**
 * Active session: start / pause / resume / finish, live KPIs, the review queue (screenshot
 * detections that need the user), the live feed and the screenshots taken.
 */
import { AnimatePresence, motion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  type DeckEvent,
  type DeckKeyState,
  type DeckLogStatus,
  type DeckSessionInput,
  type DeckSessionSummary,
  decksAddManual,
  decksCaptureImage,
  decksCreate,
  decksEventConfirm,
  decksEventCorrect,
  decksEventRemove,
  decksEventRestore,
  decksFinish,
  decksHotkeyStatus,
  decksLogStatus,
  decksPause,
  decksRecognizeFile,
  decksResume,
  decksRetryCapture,
  decksUpdate,
  HOTKEY_STATUS_EVENT,
} from "@/core/ipc/commands";
import { useMarketOverview, useNow } from "@/core/market/hooks";
import { useLeague } from "@/core/market/LeagueContext";
import { Badge, Button, EmptyState, IconButton, Input, Kbd, Modal, Panel, ProvenanceTag, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { formatDuration } from "@/shared/utilities/format";
import { type PriceBook, roiOf, unitPrice, valueCards } from "./analytics";
import { GAME, useDeckSession, useDecksUpdated } from "./hooks";
import { type DeckPrefs, sessionName } from "./prefs";
import { ACQUISITION_LABEL, ACQUISITIONS, CardArt, Kpi, Money, Profit, Roi, SOURCE_LABEL, StatusBadge, timeLabel, UNIT } from "./ui";
import { listen } from "@tauri-apps/api/event";

const errText = (e: unknown) => String(e).replace(/^Error: /, "");

// ---------- session form ----------

export function SessionForm({
  open,
  onClose,
  initial,
  title,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  initial: DeckSessionInput;
  title: string;
  submitLabel: string;
  onSubmit: (input: DeckSessionInput) => Promise<void>;
}) {
  const { leagues } = useLeague();
  const [v, setV] = useState(initial);
  const [decks, setDecks] = useState(initial.plannedDecks?.toString() ?? "");
  const [cost, setCost] = useState(initial.costTotal?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currency = useMarketOverview(GAME, v.league, open && v.league ? "currency" : null);
  const deckPrice = currency.snapshot?.items.find((i) => i.itemId === "stacked-deck")?.value ?? null;

  useEffect(() => {
    if (!open) return;
    setV(initial);
    setDecks(initial.plannedDecks?.toString() ?? "");
    setCost(initial.costTotal?.toString() ?? "");
    setError(null);
  }, [open]);

  const decksN = decks.trim() === "" ? null : Number(decks);
  const costN = cost.trim() === "" ? null : Number(cost);
  const invalid = !v.name.trim() || (decksN !== null && (!Number.isInteger(decksN) || decksN < 0)) || (costN !== null && (!Number.isFinite(costN) || costN < 0));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...v, plannedDecks: decksN, costTotal: costN, notes: v.notes?.trim() ? v.notes : null, openedOn: v.openedOn || null });
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={invalid} loading={busy} onClick={submit}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Input label="Session name" value={v.name} maxLength={120} onChange={(e) => setV({ ...v, name: e.target.value })} containerClassName="col-span-2" />
        <Select
          label="League"
          value={v.league ?? ""}
          onChange={(l) => setV({ ...v, league: l || null })}
          options={[{ value: "", label: "No league" }, ...leagues.map((l) => ({ value: l.name, label: l.displayName }))]}
        />
        <Input label="Opening date" type="date" value={v.openedOn ?? ""} onChange={(e) => setV({ ...v, openedOn: e.target.value || null })} hint="Optional" />
        <Input label="Stacked Decks" type="number" min={0} step={1} value={decks} onChange={(e) => setDecks(e.target.value)} hint="Optional — how many you're opening" />
        <Select label="Acquisition" value={v.acquisition} onChange={(a) => setV({ ...v, acquisition: a })} options={ACQUISITIONS.map((a) => ({ value: a, label: ACQUISITION_LABEL[a] }))} />
        <div className="col-span-2 flex items-end gap-2">
          <Input
            label="Total acquisition cost"
            type="number"
            min={0}
            step="any"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            suffix={UNIT.short}
            hint="Optional — without it there's no profit or ROI"
            containerClassName="flex-1"
          />
          <Button
            size="sm"
            variant="secondary"
            className="mb-6"
            disabled={deckPrice === null || !decksN}
            title={deckPrice === null ? "No poe.ninja Stacked Deck price for this league" : "Decks × current poe.ninja Stacked Deck price"}
            onClick={() => deckPrice !== null && decksN && setCost((Math.round(deckPrice * decksN * 100) / 100).toString())}
          >
            Market price{deckPrice !== null ? ` (${deckPrice.toFixed(2)} c each)` : ""}
          </Button>
        </div>
        <label className="col-span-2 flex flex-col gap-1.5 text-xs text-fg-muted">
          Notes
          <textarea
            value={v.notes ?? ""}
            maxLength={4000}
            onChange={(e) => setV({ ...v, notes: e.target.value })}
            className="well h-20 resize-none rounded-md p-2 text-sm text-fg"
            placeholder="Optional"
          />
        </label>
        {error && <p className="col-span-2 text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

// ---------- card picker ----------

/** Text field with the card names as suggestions (native datalist). */
export function CardPicker({ names, value, onChange, onSubmit, autoFocus, placeholder = "Card name" }: { names: readonly string[]; value: string; onChange: (v: string) => void; onSubmit?: () => void; autoFocus?: boolean; placeholder?: string }) {
  const id = "deck-card-names";
  return (
    <>
      <Input
        size="sm"
        list={id}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Divination card"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit?.()}
        containerClassName="w-60"
      />
      <datalist id={id}>
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}

// ---------- active session ----------

export function SessionTab({
  active,
  sessions,
  book,
  cardNames,
  prefs,
  onOpenSession,
}: {
  active: DeckSessionSummary | null;
  sessions: readonly DeckSessionSummary[];
  book: PriceBook | null;
  cardNames: readonly string[];
  prefs: DeckPrefs;
  onOpenSession: (id: number) => void;
}) {
  const { league } = useLeague();
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const initial: DeckSessionInput = useMemo(
    () => ({
      name: sessionName(prefs.nameFormat, new Date(), sessions.length + 1),
      league,
      openedOn: null,
      plannedDecks: null,
      acquisition: prefs.defaultAcquisition,
      costTotal: null,
      notes: null,
    }),
    [prefs.nameFormat, prefs.defaultAcquisition, sessions.length, league],
  );

  if (!active) {
    return (
      <>
        <Panel>
          <div className="mx-auto flex max-w-2xl flex-col items-center py-8 text-center">
            <span className="grid size-10 place-items-center rounded-lg border border-line-strong bg-elevated text-fg-muted">
              <Icon name="cards" size={22} />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-fg">Start an opening session</h2>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              Open your Stacked Decks the way you always do. While a session runs, Vaalytics records every card the game writes to Client.txt
              (<span className="text-fg">“Card drawn from the deck”</span>) and — when you press your screenshot key — reads the card labels on the ground.
              Nothing is captured without a key press.
            </p>
            <Button variant="primary" icon="play" className="mt-5" onClick={() => setCreating(true)}>
              Start session
            </Button>
            <ol className="mt-6 grid w-full grid-cols-3 gap-3 text-left text-xs text-fg-muted">
              <li className="rounded-md border border-line bg-bg-2 p-3">
                <span className="font-medium text-fg">1 · Start</span>
                <br />
                Name it, optionally add the deck count and what they cost.
              </li>
              <li className="rounded-md border border-line bg-bg-2 p-3">
                <span className="font-medium text-fg">2 · Open</span>
                <br />
                Drop cards on the ground or into your inventory. Press the screenshot key over the ground labels.
              </li>
              <li className="rounded-md border border-line bg-bg-2 p-3">
                <span className="font-medium text-fg">3 · Finish</span>
                <br />
                Review uncertain reads, finish — the card values are frozen as the session's valuation.
              </li>
            </ol>
          </div>
        </Panel>
        <SessionForm
          open={creating}
          onClose={() => setCreating(false)}
          initial={initial}
          title="New opening session"
          submitLabel="Start session"
          onSubmit={async (input) => {
            await decksCreate(GAME, input);
            notify("success", "Session started", input.name);
          }}
        />
      </>
    );
  }
  return <ActiveSession summary={active} book={book} cardNames={cardNames} onOpenSession={onOpenSession} notifyFinished={prefs.notifyFinished} />;
}

function useTrackingStatus() {
  const [log, setLog] = useState<DeckLogStatus | null>(null);
  const [key, setKey] = useState<DeckKeyState | null>(null);
  const reload = useCallback(() => {
    decksLogStatus(GAME).then(setLog).catch(() => setLog(null));
    decksHotkeyStatus(GAME).then(setKey).catch(() => setKey(null));
  }, []);
  useEffect(reload, [reload]);
  useDecksUpdated(reload);
  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    listen(HOTKEY_STATUS_EVENT, reload)
      .then((u) => (disposed ? u() : (un = u)))
      .catch(() => {});
    return () => {
      disposed = true;
      un?.();
    };
  }, [reload]);
  return { log, key };
}

function ActiveSession({ summary, book, cardNames, onOpenSession, notifyFinished }: { summary: DeckSessionSummary; book: PriceBook | null; cardNames: readonly string[]; onOpenSession: (id: number) => void; notifyFinished: boolean }) {
  const notify = useToast();
  const { detail } = useDeckSession(summary.id);
  const running = summary.status === "running";
  const now = useNow(running ? 1000 : 60_000);
  const [editing, setEditing] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [busy, setBusy] = useState(false);
  const { log, key } = useTrackingStatus();
  const events = detail?.events ?? [];
  const live = events.filter((e) => e.status !== "removed");
  const confirmed = events.filter((e) => e.status === "confirmed");
  const pending = events.filter((e) => e.status === "review" || e.status === "unrecognized");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of confirmed) if (e.card) m.set(e.card, (m.get(e.card) ?? 0) + 1);
    return [...m].map(([card, qty]) => ({ card, qty }));
  }, [confirmed]);
  const value = valueCards(counts, book);
  const cost = summary.costTotal;
  const profit = cost !== null ? value.value - cost : null;
  // activeSecs from Rust includes the running stretch up to when it was read; add the time since.
  const readAt = useMemo(() => Date.now(), [summary]);
  const shownSecs = summary.activeSecs + (running ? Math.max(0, Math.floor((now - readAt) / 1000)) : 0);

  const act = async (f: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await f();
      if (ok) notify("success", ok);
    } catch (e) {
      notify("warning", "Couldn't do that", errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="panel flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-4 py-3">
        <span className={cn("size-2.5 rounded-full", running ? "bg-success" : "bg-warning")} aria-hidden />
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-fg">{summary.name}</div>
          <div className="text-xs text-fg-muted">
            {running ? "Running" : "Paused"} · {summary.league ?? "No league"} · {ACQUISITION_LABEL[summary.acquisition]}
          </div>
        </div>
        <div className="tabular ml-2 text-2xl font-semibold text-fg" title="Time running (pauses excluded)">
          {formatDuration(shownSecs)}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon="sliders" onClick={() => setEditing(true)}>
            Edit
          </Button>
          {running ? (
            <Button size="sm" variant="secondary" icon="pause" disabled={busy} onClick={() => act(() => decksPause(GAME, summary.id))}>
              Pause
            </Button>
          ) : (
            <Button size="sm" variant="secondary" icon="play" disabled={busy} onClick={() => act(() => decksResume(GAME, summary.id))}>
              Resume
            </Button>
          )}
          <Button size="sm" variant="primary" icon="check" disabled={busy} onClick={() => setConfirmFinish(true)}>
            Finish session
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Decks opened" value={confirmed.length} sub={summary.plannedDecks ? `of ${summary.plannedDecks} planned` : "confirmed cards"} />
        <Kpi label="Cards detected" value={live.length} sub={`${events.length - live.length} removed`} />
        <Kpi label="Confirmed" value={confirmed.length} />
        <Kpi label="Needs review" value={pending.length} sub={pending.length ? "not in totals yet" : "nothing waiting"} />
        <Kpi label="Est. card value" tone="accent" value={<Money value={value.value} strong />} sub={value.unpriced ? `${value.unpriced} unpriced` : "live poe.ninja prices"} />
        <Kpi label="Cost" value={<Money value={cost} />} sub={cost === null ? "not entered" : summary.plannedDecks ? `${(cost / summary.plannedDecks).toFixed(2)} c / deck` : undefined} />
        <Kpi label="Est. profit" value={<Profit value={profit} />} />
        <Kpi label="Est. ROI" value={<Roi value={roiOf(profit, cost)} />} />
      </div>

      <TrackingStrip log={log} hotkey={key} sessionId={summary.id} running={running} cardNames={cardNames} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <ReviewQueue events={pending} cardNames={cardNames} />
        <LiveFeed events={events} book={book} />
      </div>

      {detail && detail.captures.length > 0 && <CapturesPanel captures={detail.captures} events={events} />}

      <div className="flex items-center gap-2 text-2xs text-fg-subtle">
        <ProvenanceTag provenance={{ kind: "estimate", source: "poe.ninja prices", at: book?.at ?? null, league: book?.league ?? undefined }} />
        Values are estimates from market prices, not sale prices. Cards waiting for review aren't counted.
      </div>

      <SessionForm
        open={editing}
        onClose={() => setEditing(false)}
        initial={{ name: summary.name, league: summary.league, openedOn: summary.openedOn, plannedDecks: summary.plannedDecks, acquisition: summary.acquisition, costTotal: summary.costTotal, notes: summary.notes }}
        title="Edit session"
        submitLabel="Save"
        onSubmit={(input) => decksUpdate(GAME, summary.id, input)}
      />
      <Modal
        open={confirmFinish}
        onClose={() => setConfirmFinish(false)}
        title="Finish this session?"
        description="Tracking stops and the session becomes read-only. Today's prices are frozen as its original valuation; later you'll see both that and the current value."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmFinish(false)}>
              Keep going
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() =>
                act(async () => {
                  await decksFinish(GAME, summary.id);
                  setConfirmFinish(false);
                  onOpenSession(summary.id);
                }, notifyFinished ? "Session finished" : undefined)
              }
            >
              Finish
            </Button>
          </>
        }
      >
        {pending.length > 0 && (
          <p className="flex gap-2 text-sm text-warning">
            <Icon name="warning" size={16} className="mt-0.5 shrink-0" />
            {pending.length} {pending.length === 1 ? "entry still needs" : "entries still need"} review. They won't be counted unless you confirm them first.
          </p>
        )}
      </Modal>
    </div>
  );
}

function TrackingStrip({ log, hotkey, sessionId, running, cardNames }: { log: DeckLogStatus | null; hotkey: DeckKeyState | null; sessionId: number; running: boolean; cardNames: readonly string[] }) {
  const notify = useToast();
  const [card, setCard] = useState("");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const n = Number(qty);
    if (!card.trim() || !Number.isInteger(n) || n < 1) return;
    setBusy(true);
    try {
      await decksAddManual(GAME, sessionId, card.trim(), n);
      notify("success", `Added ${n} × ${card.trim()}`);
      setCard("");
      setQty("1");
    } catch (e) {
      notify("warning", "Couldn't add the card", errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg px-4 py-3 text-xs">
      <div className="flex items-center gap-2">
        <Icon name="journal" size={15} className={log?.watching && running ? "text-success" : "text-fg-subtle"} />
        <span className="text-fg-muted">Client.txt</span>
        <span className={log?.error ? "text-warning" : "text-fg"}>
          {!running ? "paused" : log?.error ? log.error : log?.watching ? "reading new lines" : "waiting"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Icon name="cursor" size={15} className={hotkey?.registered ? "text-success" : "text-fg-subtle"} />
        <span className="text-fg-muted">Screenshot key</span>
        {hotkey?.key ? <Kbd>{hotkey.key}</Kbd> : <span className="text-fg-subtle">not set (Settings tab)</span>}
        {hotkey?.key && <span className={hotkey.error ? "text-warning" : "text-fg-subtle"}>{hotkey.error ?? (hotkey.registered ? "active in game" : "active while PoE is focused")}</span>}
      </div>
      <Button
        size="sm"
        variant="ghost"
        icon="download"
        onClick={() =>
          decksRecognizeFile(GAME, sessionId)
            .then((r) => r && notify(r.error ? "warning" : "success", r.error ? "Screenshot not read" : `${r.cards.length} labels read`, r.error ?? undefined))
            .catch((e) => notify("warning", "Couldn't read the screenshot", errText(e)))
        }
      >
        Recognise a screenshot file…
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <CardPicker names={cardNames} value={card} onChange={setCard} onSubmit={add} placeholder="Add a card manually" />
        <Input size="sm" type="number" min={1} max={500} value={qty} onChange={(e) => setQty(e.target.value)} containerClassName="w-16" aria-label="Quantity" />
        <Button size="sm" variant="secondary" icon="plus" disabled={!card.trim() || busy} onClick={add}>
          Add
        </Button>
      </div>
    </section>
  );
}

// ---------- review ----------

function ReviewQueue({ events, cardNames }: { events: DeckEvent[]; cardNames: readonly string[] }) {
  const notify = useToast();
  const run = (f: Promise<unknown>) => f.catch((e) => notify("warning", "Couldn't update the entry", errText(e)));
  const dupes = events.filter((e) => e.reviewReason?.startsWith("Possibly the same") || e.reviewReason?.startsWith("Also recorded"));
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Needs review <Badge tone={events.length ? "warning" : "neutral"}>{events.length}</Badge>
        </span>
      }
      actions={
        dupes.length > 0 && (
          <Button size="sm" variant="ghost" icon="trash" onClick={() => Promise.all(dupes.map((d) => decksEventRemove(GAME, d.id))).catch((e) => notify("warning", "Couldn't remove", errText(e)))}>
            Remove {dupes.length} likely duplicate{dupes.length === 1 ? "" : "s"}
          </Button>
        )
      }
      flush
    >
      {events.length === 0 ? (
        <EmptyState icon="success" title="Nothing to review" body="Uncertain screenshot reads and possible duplicates appear here. They never count until you confirm them." className="py-10" />
      ) : (
        <ul className="max-h-[460px] divide-y divide-line overflow-y-auto">
          {events.map((e) => (
            <ReviewRow key={e.id} e={e} cardNames={cardNames} run={run} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

const ReviewRow = memo(function ReviewRow({ e, cardNames, run }: { e: DeckEvent; cardNames: readonly string[]; run: (p: Promise<unknown>) => void }) {
  const [fixing, setFixing] = useState(false);
  const [name, setName] = useState(e.card ?? e.recognizedCard ?? "");
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <CardArt name={e.card ?? "?"} size={26} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-fg">{e.card ?? (e.recognizedCard ? <span className="text-fg-muted">Maybe {e.recognizedCard}?</span> : "Unreadable label")}</div>
          <div className="truncate text-2xs text-fg-subtle" title={e.reviewReason ?? undefined}>
            {e.reviewReason ?? "Check this entry"} · read “{e.recognizedText ?? "—"}” · {Math.round(e.confidence * 100)}%
          </div>
        </div>
        <StatusBadge status={e.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-9">
        {fixing ? (
          <>
            <CardPicker names={cardNames} value={name} onChange={setName} autoFocus onSubmit={() => name.trim() && run(decksEventCorrect(GAME, e.id, name.trim()))} />
            <Button size="sm" variant="primary" disabled={!name.trim()} onClick={() => run(decksEventCorrect(GAME, e.id, name.trim()))}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFixing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {e.card && (
              <Button size="sm" variant="secondary" icon="check" onClick={() => run(decksEventConfirm(GAME, e.id))}>
                Confirm
              </Button>
            )}
            <Button size="sm" variant="ghost" icon="sliders" onClick={() => setFixing(true)}>
              {e.card ? "Correct" : "Pick card"}
            </Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => run(decksEventRemove(GAME, e.id))}>
              Remove
            </Button>
          </>
        )}
      </div>
    </li>
  );
});

// ---------- live feed ----------

const FEED_LIMIT = 150;

function LiveFeed({ events, book }: { events: DeckEvent[]; book: PriceBook | null }) {
  const notify = useToast();
  const [showRemoved, setShowRemoved] = useState(false);
  const shown = useMemo(() => {
    const list = events.filter((e) => showRemoved || e.status !== "removed");
    return list.slice(-FEED_LIMIT).reverse();
  }, [events, showRemoved]);
  return (
    <Panel
      title={`Live feed · ${events.filter((e) => e.status !== "removed").length}`}
      actions={
        <Button size="sm" variant="ghost" onClick={() => setShowRemoved((s) => !s)}>
          {showRemoved ? "Hide removed" : "Show removed"}
        </Button>
      }
      flush
    >
      {shown.length === 0 ? (
        <EmptyState icon="cards" title="No cards yet" body="Open a Stacked Deck in game — cards from Client.txt appear within ~2 seconds, ground screenshots as soon as they're read." className="py-10" />
      ) : (
        <ul className="max-h-[460px] overflow-y-auto">
          <AnimatePresence initial={false}>
            {shown.map((e) => (
              <FeedRow key={e.id} e={e} book={book} onRemove={() => decksEventRemove(GAME, e.id).catch((x) => notify("warning", "Couldn't remove", errText(x)))} onRestore={() => decksEventRestore(GAME, e.id).catch((x) => notify("warning", "Couldn't restore", errText(x)))} />
            ))}
          </AnimatePresence>
          {events.length > FEED_LIMIT && <li className="px-4 py-2 text-2xs text-fg-subtle">Showing the latest {FEED_LIMIT}. The session report lists every card.</li>}
        </ul>
      )}
    </Panel>
  );
}

const FeedRow = memo(function FeedRow({ e, book, onRemove, onRestore }: { e: DeckEvent; book: PriceBook | null; onRemove: () => void; onRestore: () => void }) {
  const price = e.card ? unitPrice(book, e.card) : null;
  const big = price !== null && price.value >= 50;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className={cn("flex items-center gap-3 border-b border-line px-4 py-2 text-sm", big && "bg-accent-soft", e.status === "removed" && "opacity-45")}
    >
      <CardArt name={e.card ?? "?"} size={26} />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate", big ? "font-semibold text-accent-2" : "text-fg", e.status === "removed" && "line-through")}>{e.card ?? e.recognizedText ?? "Unreadable"}</div>
        <div className="truncate text-2xs text-fg-subtle">
          {timeLabel(e.at)} · {SOURCE_LABEL[e.source]}
          {e.source === "ocr" && ` · ${Math.round(e.confidence * 100)}%`}
          {e.corrected && " · corrected"}
        </div>
      </div>
      {e.status !== "confirmed" && <StatusBadge status={e.status} />}
      <span className="w-20 text-right">{e.card ? <Money value={price?.value ?? null} unknown="no price" /> : null}</span>
      {e.status === "removed" ? <IconButton size="sm" icon="refresh" label="Restore" onClick={onRestore} /> : <IconButton size="sm" icon="close" label="Remove" onClick={onRemove} />}
    </motion.li>
  );
});

// ---------- screenshots ----------

function CapturesPanel({ captures, events }: { captures: NonNullable<ReturnType<typeof useDeckSession>["detail"]>["captures"]; events: DeckEvent[] }) {
  const notify = useToast();
  const [view, setView] = useState<{ id: number; url: string | null } | null>(null);
  const list = [...captures].reverse().slice(0, 12);
  return (
    <Panel title={`Screenshots · ${captures.length}`} flush>
      <ul className="divide-y divide-line">
        {list.map((c) => {
          const ev = events.filter((e) => e.captureId === c.id);
          const byStatus = (s: string) => ev.filter((e) => e.status === s).length;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs">
              <span className="tabular text-fg">{timeLabel(c.takenAt)}</span>
              <span className="text-fg-subtle">{c.source === "file" ? "file" : "hotkey"} · {c.width}×{c.height}</span>
              {c.error ? (
                <span className="text-warning">{c.error}</span>
              ) : (
                <span className="text-fg-muted">
                  {byStatus("confirmed")} confirmed · {byStatus("review")} review · {byStatus("unrecognized")} unrecognized · {c.ignoredLines} other text ignored
                </span>
              )}
              <span className="ml-auto flex gap-1">
                {c.hasImage && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => decksCaptureImage(GAME, c.id).then((url) => setView({ id: c.id, url }))}>
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="refresh"
                      onClick={() =>
                        decksRetryCapture(GAME, c.id)
                          .then((r) => notify("success", "Read again", `${r.cards.length} new entries; your corrections were kept.`))
                          .catch((e) => notify("warning", "Couldn't read it again", errText(e)))
                      }
                    >
                      Retry
                    </Button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <Modal open={view !== null} onClose={() => setView(null)} title="Screenshot" size="lg" description="Stored locally only. Boxes mark what was read.">
        {view?.url ? <CaptureImage url={view.url} events={events.filter((e) => e.captureId === view.id)} /> : <p className="text-sm text-fg-muted">This screenshot wasn't kept.</p>}
      </Modal>
    </Panel>
  );
}

function CaptureImage({ url, events }: { url: string; events: DeckEvent[] }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const tone: Record<string, string> = { confirmed: "border-success", review: "border-warning", unrecognized: "border-danger", removed: "border-fg-subtle" };
  return (
    <div className="relative">
      <img src={url} alt="Captured ground labels" className="w-full rounded-md" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {size &&
        events.map(
          (e) =>
            e.bbox && (
              <span
                key={e.id}
                title={`${e.card ?? e.recognizedText ?? "?"} · ${e.status}`}
                className={cn("absolute rounded-sm border-2", tone[e.status])}
                style={{ left: `${(e.bbox.x / size.w) * 100}%`, top: `${(e.bbox.y / size.h) * 100}%`, width: `${(e.bbox.w / size.w) * 100}%`, height: `${(e.bbox.h / size.h) * 100}%` }}
              />
            ),
        )}
    </div>
  );
}
