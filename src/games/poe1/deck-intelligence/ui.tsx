/** Small shared pieces of the Deck Intelligence views. */
import { memo, type ReactNode, useState } from "react";
import { type DeckAcquisition, type DeckEventSource, type DeckEventStatus, decksSetOpened } from "@/core/ipc/commands";
import { useDisplayCurrency } from "@/core/market/DisplayCurrency";
import { Badge, type BadgeTone, Button, IconButton, Input, useToast } from "@/shared/components";
import { cn } from "@/shared/utilities/cn";
import { formatAmount } from "@/shared/utilities/format";
import { Price } from "@/shared/views/common";
import { ItemIcon } from "@/shared/views/market-ui";
import { POE1_CONFIG } from "../config";

export const UNIT = POE1_CONFIG.baseUnit;

/**
 * The official Divination Card inventory icon (web.poecdn.com). Per-card artwork has no verified
 * source yet, so every card shows the same card icon (docs/modules/deck-intelligence.md).
 */
export const CARD_ICON = "https://web.poecdn.com/image/Art/2DItems/Divination/InventoryIcon.png";

export const CardArt = memo(function CardArt({ name, size = 28, src }: { name: string; size?: number; src?: string | null }) {
  return <ItemIcon src={src ?? CARD_ICON} name={name} size={size} />;
});

/** A chaos amount, or an explicit "unknown" (never 0). */
export function Money({ value, strong, className, unknown = "Unknown" }: { value: number | null | undefined; strong?: boolean; className?: string; unknown?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cn("text-xs text-fg-subtle", className)}>{unknown}</span>;
  return <Price amount={value} unit={UNIT} strong={strong} className={className} />;
}

/** Signed profit: green above zero, red below. Follows "Prices in" like `Money`. */
export function Profit({ value, className, unknown = "No cost" }: { value: number | null; className?: string; unknown?: string }) {
  const d = useDisplayCurrency();
  if (value === null) return <span className={cn("text-xs text-fg-subtle", className)}>{unknown}</span>;
  const convert = d !== null && d.converting && d.base.id === UNIT.id;
  const shown = convert ? d.toUnit(value) : value;
  const unit = convert ? d.unit : UNIT;
  const tone = value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-fg-muted";
  return (
    <span className={cn("tabular whitespace-nowrap", tone, className)} title={`${formatAmount(value)} ${UNIT.name}`}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {formatAmount(Math.abs(shown))}
      <span className="ml-1 text-xs opacity-70">{unit.short}</span>
    </span>
  );
}

/**
 * "Decks opened" with an inline editor: the user's own count (ground openings aren't in Client.txt and a
 * screenshot can miss labels). Clearing it goes back to counting confirmed cards.
 */
export function OpenedEditor({ sessionId, decks, entered, cards }: { sessionId: number; decks: number; entered: boolean; cards: number }) {
  const notify = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const n = text.trim() === "" ? null : Number(text);
  const valid = n === null || (Number.isInteger(n) && n >= 0 && n <= 1_000_000);
  const save = (value: number | null) =>
    decksSetOpened("poe1", sessionId, value)
      .then(() => setEditing(false))
      .catch((e) => notify("warning", "Couldn't save the number of decks", String(e).replace(/^Error: /, "")));
  if (!editing)
    return (
      <span className="flex items-center gap-1.5">
        <span className="tabular">{decks.toLocaleString()}</span>
        <IconButton
          size="sm"
          icon="sliders"
          label="Set the number of decks opened"
          onClick={() => {
            setText(entered ? String(decks) : "");
            setEditing(true);
          }}
        />
      </span>
    );
  return (
    <span className="flex flex-col gap-1.5">
      <Input
        size="sm"
        type="number"
        min={Math.max(0, cards)}
        autoFocus
        value={text}
        placeholder={String(cards)}
        aria-label="Decks opened"
        error={valid ? undefined : "0–1,000,000"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid) save(n);
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <span className="flex gap-1">
        <Button size="sm" variant="primary" disabled={!valid} onClick={() => save(n)}>
          Save
        </Button>
        {entered && (
          <Button size="sm" variant="ghost" onClick={() => save(null)} title="Count confirmed cards instead">
            Clear
          </Button>
        )}
      </span>
    </span>
  );
}

export function Roi({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className={cn("text-xs text-fg-subtle", className)} title="ROI needs a known, non-zero acquisition cost">—</span>;
  const tone = value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-fg-muted";
  return (
    <span className={cn("tabular", tone, className)}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {Math.abs(value) >= 100 ? Math.round(Math.abs(value)) : Math.abs(value).toFixed(1)}%
    </span>
  );
}

export const fmtPct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) >= 100 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)}%`);
export const fmtChaos = (v: number) => `${formatAmount(v)} c`;
export const fmtSigned = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatAmount(Math.abs(v))} c`;

export const STATUS_LABEL: Record<DeckEventStatus, string> = { confirmed: "Confirmed", review: "Needs review", unrecognized: "Unrecognized", removed: "Removed" };
const STATUS_TONE: Record<DeckEventStatus, BadgeTone> = { confirmed: "success", review: "warning", unrecognized: "danger", removed: "neutral" };

export function StatusBadge({ status }: { status: DeckEventStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export const SOURCE_LABEL: Record<DeckEventSource, string> = { ocr: "Ground screenshot", log: "Client.txt", manual: "Added by you", import: "Client.txt import" };

export const ACQUISITION_LABEL: Record<DeckAcquisition, string> = {
  individual: "Bought individually",
  bulk: "Bought in bulk",
  farmed: "Farmed",
  free: "Free",
  unknown: "Unknown",
};
export const ACQUISITIONS = Object.keys(ACQUISITION_LABEL) as DeckAcquisition[];

/** KPI tile with a clear hierarchy: label, big value, supporting line. */
export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "accent" }) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface px-4 py-3", tone === "accent" && "border-line-warm")}>
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-1.5 text-xl leading-none font-semibold text-fg">{value}</div>
      {sub && <div className="mt-1.5 line-clamp-2 text-xs leading-snug text-fg-muted">{sub}</div>}
    </div>
  );
}

export const dateLabel = (sec: number) => new Date(sec * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
export const timeLabel = (sec: number) => new Date(sec * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const shortDate = (sec: number) => new Date(sec * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
