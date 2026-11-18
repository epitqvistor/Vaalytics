/**
 * Loot Journal (PoE 2): items copied in the game (Ctrl+C) are captured in the
 * background by the Rust service, categorised, de-duplicated and valued
 * automatically. This view browses and analyses them. Captured items only —
 * never presented as all loot. Spec: docs/modules/loot-journal.md
 */
import { useEffect, useRef, useState } from "react";
import { lootRevalue } from "@/core/ipc/commands";
import { useLeague } from "@/core/market/LeagueContext";
import type { SectionProps } from "@/core/game-context/sections";
import { EmptyState, PageHeader, SegmentedControl } from "@/shared/components";
import { DisplayCurrencySelect, LeagueSelect } from "@/shared/views/market-ui";
import { AnalyticsTab } from "./AnalyticsTab";
import { useLootConfig, useLootItems, useLootStatus } from "./hooks";
import { ItemDetailModal } from "./ItemDetail";
import { LibraryTab } from "./LibraryTab";
import { OverviewTab } from "./OverviewTab";
import { SettingsTab } from "./SettingsTab";
import { CaptureBadge } from "./ui";

type Tab = "overview" | "library" | "analytics" | "settings";
const TABS = [
  { value: "overview", label: "Overview" },
  { value: "library", label: "Library" },
  { value: "analytics", label: "Analytics" },
  { value: "settings", label: "Settings" },
] as const;
const ALL_ITEMS = { sort: "newest", limit: 20000 } as const;

export default function LootJournal(_props: SectionProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const [openId, setOpenId] = useState<number | null>(null);
  const status = useLootStatus();
  const config = useLootConfig();
  const items = useLootItems(ALL_ITEMS);
  const { league } = useLeague();
  const prevLeague = useRef<string | null>(null);
  useEffect(() => {
    // Prices come from the selected league; re-value when it changes.
    if (league && prevLeague.current && prevLeague.current !== league) lootRevalue("poe2", []).catch(() => undefined);
    prevLeague.current = league;
  }, [league]);

  return (
    <div className="mx-auto max-w-[1360px]">
      <PageHeader
        title="Loot Journal"
        description="Items you copy in Path of Exile 2 (Ctrl+C) are saved, categorised and valued automatically. It records captured items only — not everything you pick up."
        actions={
          <>
            {status && <CaptureBadge listening={status.listening} enabled={status.enabled} />}
            <DisplayCurrencySelect />
            <LeagueSelect />
          </>
        }
      />
      <div className="mb-5">
        <SegmentedControl label="Section" value={tab} onChange={setTab} segments={TABS} />
      </div>
      {items.error ? (
        <EmptyState icon="error" title="Loot Journal is unavailable" body={items.error} />
      ) : items.data === null ? (
        <EmptyState icon="journal" title="Loading…" loading />
      ) : tab === "overview" ? (
        <OverviewTab items={items.data} status={status} onOpen={setOpenId} />
      ) : tab === "library" ? (
        <LibraryTab onOpen={setOpenId} />
      ) : tab === "analytics" ? (
        <AnalyticsTab items={items.data} onOpen={setOpenId} />
      ) : config.data ? (
        <SettingsTab config={config.data} setConfig={config.set} />
      ) : (
        <EmptyState icon="settings" title={config.error ?? "Loading…"} loading={!config.error} />
      )}
      <ItemDetailModal id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
