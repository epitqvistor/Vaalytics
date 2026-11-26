/**
 * Deck Intelligence (PoE 1): Stacked Deck opening sessions — Client.txt and ground-screenshot
 * tracking, permanent history with original valuations, statistics and your card collection.
 * Spec: docs/modules/deck-intelligence.md
 */
import { useEffect, useMemo, useState } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import { useLeague } from "@/core/market/LeagueContext";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { Badge, EmptyState, PageHeader, SegmentedControl } from "@/shared/components";
import { DisplayCurrencySelect, LeagueSelect } from "@/shared/views/market-ui";
import { DEFAULT_FILTER, sessionView, type StatsFilter } from "./analytics";
import { CollectionTab } from "./CollectionTab";
import { HistoryTab, SessionDetail } from "./HistoryTab";
import { GAME, useCardDb, useDeckSessions, usePriceBook } from "./hooks";
import { DEFAULT_PREFS, type DeckPrefs, isPrefs, PREFS_KEY } from "./prefs";
import { SessionTab } from "./SessionTab";
import { SettingsTab } from "./SettingsTab";
import { StatsTab } from "./StatsTab";

type Tab = "session" | "stats" | "history" | "collection" | "settings";

export default function DeckIntelligence(_props: SectionProps) {
  const { league } = useLeague();
  const { sessions, totals, error } = useDeckSessions();
  const cards = useCardDb();
  const prices = usePriceBook(league);
  const [prefs, setPrefs, prefsLoaded] = useGameSetting<DeckPrefs>(GAME, PREFS_KEY, DEFAULT_PREFS, isPrefs);
  const [tab, setTab] = useState<Tab>("session");
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<StatsFilter>(DEFAULT_FILTER);
  const [filterInit, setFilterInit] = useState(false);

  useEffect(() => {
    if (!prefsLoaded || filterInit || !league) return;
    setFilter({ ...DEFAULT_FILTER, range: prefs.defaultRange, league: prefs.defaultLeague === "current" ? league : "all" });
    setFilterInit(true);
  }, [prefsLoaded, filterInit, league, prefs.defaultRange, prefs.defaultLeague]);

  const views = useMemo(() => (sessions ?? []).map((s) => sessionView(s, totals, prices.book)), [sessions, totals, prices.book]);
  const active = useMemo(() => (sessions ?? []).find((s) => s.status === "running" || s.status === "paused") ?? null, [sessions]);
  const names = useMemo(() => {
    const set = new Set((cards.db?.cards ?? []).filter((c) => !c.legacy).map((c) => c.name));
    for (const n of prices.book?.market.keys() ?? []) set.add(n);
    return [...set].sort();
  }, [cards.db, prices.book]);
  const reviewCount = active ? active.review + active.unrecognized : 0;
  const openSession = (id: number) => {
    setOpenId(id);
    setTab("history");
  };

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Deck Intelligence"
        description="Track your Stacked Deck openings — from Client.txt and ground screenshots — and see what they were really worth."
        actions={
          <>
            <DisplayCurrencySelect />
            <LeagueSelect />
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="View"
          value={tab}
          onChange={(t: Tab) => {
            setTab(t);
            if (t !== "history") setOpenId(null);
          }}
          segments={[
            { value: "session", label: active ? `Session${active.status === "paused" ? " · paused" : " · live"}` : "Session" },
            { value: "stats", label: "Statistics" },
            { value: "history", label: `History${sessions ? ` · ${sessions.length}` : ""}` },
            { value: "collection", label: "Collection" },
            { value: "settings", label: "Settings" },
          ]}
        />
        {reviewCount > 0 && tab !== "session" && <Badge tone="warning">{reviewCount} to review</Badge>}
        {cards.error && <span className="text-xs text-warning">Card list unavailable: {cards.error}</span>}
        {prices.error && <span className="text-xs text-warning">Prices unavailable: {prices.error}</span>}
      </div>

      {error ? (
        <EmptyState icon="error" title="Couldn't load Deck Intelligence" body={error} />
      ) : sessions === null ? (
        <EmptyState icon="refresh" loading title="Loading sessions…" />
      ) : (
        <>
          {tab === "session" && <SessionTab active={active} sessions={sessions} book={prices.book} cardNames={names} prefs={prefs} onOpenSession={openSession} />}
          {tab === "stats" && <StatsTab views={views} allTotals={totals} book={prices.book} prefs={prefs} filter={filter} onFilter={setFilter} onOpenSession={openSession} />}
          {tab === "history" &&
            (openId !== null ? (
              <SessionDetail id={openId} views={views} book={prices.book} prefs={prefs} onBack={() => setOpenId(null)} onOpen={setOpenId} />
            ) : (
              <HistoryTab views={views} onOpen={setOpenId} />
            ))}
          {tab === "collection" && <CollectionTab views={views} allTotals={totals} book={prices.book} cards={cards.db?.cards ?? []} onOpenSession={openSession} />}
          {tab === "settings" && (
            <SettingsTab
              prefs={prefs}
              setPrefs={setPrefs}
              cardDb={cards.db}
              cardDbError={cards.error}
              onRefreshCards={cards.refresh}
              overrides={prices.book?.manual ?? new Map()}
              onOverridesChanged={prices.reloadManual}
            />
          )}
        </>
      )}
    </div>
  );
}
