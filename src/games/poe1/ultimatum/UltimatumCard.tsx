/**
 * Inscribed Ultimatum check: risk verdict from your modifier ratings, the
 * sacrifice/reward valuation from poe.ninja and a search on the official Trade
 * site. Shown by the Price Checker (hotkey overlay and paste) for Inscribed
 * Ultimatums, and by the Ultimatum Checker module for the last checked one.
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import { setGameSetting } from "@/core/ipc/commands";
import { useMarketOverviews } from "@/core/market/hooks";
import { marketProvenance } from "@/core/provenance";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { Badge, Button, Input, Panel, ProvenanceTag, type BadgeTone } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { tradeSiteSearchUrl } from "@/shared/trade/query";
import { cn } from "@/shared/utilities/cn";
import { Price } from "@/shared/views/common";
import { FreshnessBar } from "@/shared/views/market-ui";
import { POE1_CONFIG } from "../config";
import { MODIFIER_SOURCE } from "./data/modifiers";
import type { ParsedItem } from "@/shared/item-parser/types";
import { parseUltimatum, type Ultimatum, type UltimatumModifier } from "./parse";
import {
  assessRisk,
  categoriesFor,
  isRatings,
  nextRating,
  RATING_LABEL,
  setRating,
  ultimatumTradeQuery,
  valuate,
  type Rating,
  type Ratings,
  type RiskAssessment,
} from "./ultimatum";

const unit = POE1_CONFIG.baseUnit;
const NO_RATINGS: Ratings = {};

/** Your ratings (per family), shared by the card, the planner and the ratings list. */
export function useRatings() {
  return useGameSetting<Ratings>("poe1", "ultimatum.ratings", NO_RATINGS, isRatings);
}

export interface LastCheck {
  ultimatum: Ultimatum;
  at: number;
}
export const LAST_CHECK_KEY = "ultimatum.last";
export const isLastCheck = (v: unknown): v is LastCheck => {
  if (!v || typeof v !== "object") return false;
  const l = v as Record<string, unknown>;
  const u = l.ultimatum as Record<string, unknown> | undefined;
  return typeof l.at === "number" && !!u && typeof u.challenge === "string" && typeof u.reward === "string" && Array.isArray(u.modifiers);
};

export const VERDICT: Record<RiskAssessment["verdict"], { tone: BadgeTone; label: string; body: string }> = {
  skip: {
    tone: "danger",
    label: "Skip",
    body: "Has a modifier you marked as build-breaking.",
  },
  careful: {
    tone: "warning",
    label: "Careful",
    body: "Has modifiers you marked as dangerous.",
  },
  ok: {
    tone: "success",
    label: "Looks fine",
    body: "Every penalty modifier is one you marked as fine.",
  },
  unrated: {
    tone: "neutral",
    label: "Rate modifiers",
    body: "Rate the modifiers below for your build to get a verdict.",
  },
};

export const RATING_TONE: Record<Rating, BadgeTone> = {
  ok: "success",
  danger: "warning",
  forbidden: "danger",
};

export function UltimatumCard({ ultimatum: u, league, compact, record }: { ultimatum: Ultimatum; league: string; compact?: boolean; record?: boolean }) {
  const [ratings, setRatings] = useRatings();
  const risk = useMemo(() => assessRisk(u.modifiers, ratings), [u, ratings]);

  // Remember the last checked Ultimatum for the module page (parsed fields only, not the copied text).
  useEffect(() => {
    if (record)
      setGameSetting("poe1", LAST_CHECK_KEY, {
        ultimatum: u,
        at: Date.now(),
      } as never).catch(() => {});
  }, [u, record]);

  const rate = (m: UltimatumModifier) => m.family && setRatings(setRating(ratings, m.family, nextRating(ratings[m.family])));
  const v = VERDICT[risk.verdict];

  return (
    <div className={cn("flex flex-col", compact ? "gap-3" : "gap-5")}>
      <Panel
        title={
          <span className="flex items-center gap-2">
            Inscribed Ultimatum
            {u.areaLevel && <span className="text-xs font-normal text-fg-subtle">Area level {u.areaLevel}</span>}
            {u.corrupted && <Badge tone="danger">Corrupted</Badge>}
          </span>
        }
        actions={<Badge tone={v.tone}>{v.label}</Badge>}
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-fg-muted">Challenge</dt>
          <dd className="text-fg">{u.challenge || "—"}</dd>
          <dt className="text-fg-muted">Sacrifice</dt>
          <dd className="text-fg">{u.sacrifice ? `${u.sacrifice.count > 1 ? `${u.sacrifice.count}× ` : ""}${u.sacrifice.name}` : "—"}</dd>
          <dt className="text-fg-muted">Reward</dt>
          <dd className="text-fg">{u.reward || "—"}</dd>
        </dl>
        <p className="mt-3 text-xs text-fg-muted">{v.body}</p>
      </Panel>

      <ModifierList modifiers={u.modifiers} ratings={ratings} onRate={rate} risk={risk} />
      <ValuePanel u={u} league={league} />
    </div>
  );
}

export function ModifierList({
  modifiers,
  ratings,
  onRate,
  risk,
  onRemove,
}: {
  modifiers: UltimatumModifier[];
  ratings: Ratings;
  onRate: (m: UltimatumModifier) => void;
  risk: RiskAssessment;
  onRemove?: (index: number) => void;
}) {
  return (
    <Panel
      title={`Modifiers · ${modifiers.length}`}
      flush
      actions={
        <ProvenanceTag
          provenance={{
            kind: "user",
            source: "Your ratings",
            at: null,
            note: "Click a rating to change it: Fine → Dangerous → Build-breaking → unrated.",
          }}
        />
      }
    >
      {modifiers.length === 0 ? (
        <p className="px-4 py-4 text-sm text-fg-muted">No modifiers.</p>
      ) : (
        <ul className="divide-y divide-line">
          {modifiers.map((m, i) => {
            const r = m.family ? ratings[m.family] : undefined;
            const rateable = m.kind === "penalty" || (m.kind === null && m.family !== null);
            return (
              <li key={`${m.name}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm text-fg">
                    {m.name}
                    {m.tier !== null && m.tier > 1 && <span className="text-2xs text-fg-subtle">tier {m.tier}</span>}
                    {m.family === null && (
                      <span title={`Not in the modifier list (${MODIFIER_SOURCE.source}) — can't be rated.`}>
                        <Badge tone="neutral">Unknown</Badge>
                      </span>
                    )}
                  </div>
                  {m.description && <p className="mt-0.5 text-xs text-fg-muted">{m.description}</p>}
                </div>
                {m.kind === "bonus" ? (
                  <Badge tone="info">Bonus</Badge>
                ) : m.kind === "boss" ? (
                  <Badge tone="accent">Boss</Badge>
                ) : rateable ? (
                  <button
                    type="button"
                    onClick={() => onRate(m)}
                    title="Change your rating for this modifier (all tiers)"
                    className={cn(
                      "shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                      risk.unrated.includes(m.name) && "opacity-80",
                    )}
                  >
                    <Badge tone={r ? RATING_TONE[r] : "neutral"}>{r ? RATING_LABEL[r] : "Rate"}</Badge>
                  </button>
                ) : null}
                {onRemove && (
                  <button type="button" aria-label={`Remove ${m.name}`} onClick={() => onRemove(i)} className="shrink-0 text-fg-subtle hover:text-fg">
                    <Icon name="close" size={13} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ValuePanel({ u, league }: { u: Ultimatum; league: string }) {
  const cats = useMemo(() => categoriesFor(u), [u]);
  const snaps = useMarketOverviews("poe1", league, cats);
  const [paidText, setPaidText] = useState("");
  const paid = Math.max(0, Number(paidText.replace(",", ".")) || 0);
  const loaded = cats.every((c) => snaps[c]);
  const val = useMemo(() => valuate(u, snaps, paid, unit.name), [u, snaps, paid]);
  const first = cats.length ? (snaps[cats[0]!] ?? null) : null;

  const openTrade = () => void openUrl(tradeSiteSearchUrl("poe1", league, ultimatumTradeQuery(u)));

  return (
    <Panel
      title="Is it worth it?"
      actions={
        val.ok ? (
          <ProvenanceTag
            provenance={{
              ...marketProvenance(first, league),
              kind: "estimate",
              note: "Calculated from poe.ninja prices." + (val.byName ? " Uniques priced by name: links, variants and rolls are not considered." : ""),
            }}
          />
        ) : undefined
      }
    >
      {cats.length > 0 && !loaded ? (
        <p className="text-sm text-fg-muted">Loading poe.ninja prices…</p>
      ) : !val.ok ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Icon name="info" size={14} className="text-info" /> {val.reason}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Outcome label="At stake" low={val.stake.low} high={val.stake.high} />
            <Outcome label="If you win" low={val.win.low} high={val.win.high} tone={val.win.high > 0 ? "success" : "danger"} />
            <Outcome label="If you fail" low={val.lose.low} high={val.lose.high} tone="danger" />
          </div>
          <p className="text-xs text-fg-muted">
            {val.breakEven === null ? (
              "Completing it doesn't pay off at these prices."
            ) : (
              <>
                Breaks even if you complete about <span className="tabular font-medium text-fg">{Math.round(val.breakEven * 100)}%</span> of trials like this.
                Your real success rate depends on your build — Vaalytics doesn't guess it.
              </>
            )}
          </p>
          <div className="max-w-48">
            <Input
              label="You paid for this Ultimatum (chaos)"
              inputMode="decimal"
              placeholder="0 — it dropped"
              value={paidText}
              onChange={(e) => setPaidText(e.target.value.slice(0, 12))}
            />
          </div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button icon="trade" size="sm" onClick={openTrade} disabled={!league}>
          Open on Trade
        </Button>
        <span className="text-2xs text-fg-subtle">Same challenge, reward and sacrifice on the official Trade site.</span>
      </div>
      {first && (
        <div className="mt-4 border-t border-line pt-3">
          <FreshnessBar snapshot={first} />
        </div>
      )}
    </Panel>
  );
}

function Outcome({ label, low, high, tone }: { label: string; low: number; high: number; tone?: "success" | "danger" }) {
  const same = Math.abs(high - low) < 0.005;
  return (
    <div className="rounded-md border border-line bg-bg-2 px-3 py-2">
      <div className="text-2xs text-fg-subtle">{label}</div>
      <div className={cn("tabular mt-0.5 text-sm font-medium", tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-fg")}>
        <Price amount={low} unit={unit} />
        {!same && (
          <>
            {" – "}
            <Price amount={high} unit={unit} />
          </>
        )}
      </div>
    </div>
  );
}

/** Price Checker entry: parses the copied item and records it as the last check. */
export function UltimatumCheck({ item, league, compact }: { item: ParsedItem; league: string; compact?: boolean }) {
  const u = useMemo(() => parseUltimatum(item.raw), [item.raw]);
  if (!u) return null;
  return <UltimatumCard ultimatum={u} league={league} compact={compact} record />;
}
