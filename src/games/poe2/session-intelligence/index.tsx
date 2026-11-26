/**
 * Session Intelligence (PoE 2): sessions recorded automatically from the game
 * process and Client.txt — live overview, timeline, history, analytics,
 * settings and diagnostics. Spec: docs/modules/session-intelligence.md
 */
import { useState } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import { EmptyState, PageHeader, SegmentedControl } from "@/shared/components";
import { AnalyticsTab } from "./AnalyticsTab";
import { DiagnosticsTab } from "./DiagnosticsTab";
import { HistoryTab } from "./HistoryTab";
import { useSessionStatus } from "./hooks";
import { LiveTab } from "./LiveTab";
import { SettingsTab } from "./SettingsTab";
import { TimelineTab } from "./TimelineTab";
import { StateBadge } from "./ui";

type Tab = "live" | "timeline" | "history" | "analytics" | "settings" | "diagnostics";
const TABS = [
  { value: "live", label: "Live" },
  { value: "timeline", label: "Timeline" },
  { value: "history", label: "History" },
  { value: "analytics", label: "Analytics" },
  { value: "settings", label: "Settings" },
  { value: "diagnostics", label: "Diagnostics" },
] as const;

export default function SessionIntelligence(_props: SectionProps) {
  const status = useSessionStatus("poe2");
  const [tab, setTab] = useState<Tab>("live");
  const [openId, setOpenId] = useState<number | null>(null);
  const s = status.data;

  return (
    <div className="mx-auto max-w-page">
      <PageHeader
        title="Session Intelligence"
        description="Your Path of Exile 2 sessions, recorded automatically from the game process and Client.txt (read-only)."
        actions={s && <StateBadge state={s.state} />}
      />
      <div className="mb-5">
        <SegmentedControl label="Section" value={tab} onChange={setTab} segments={TABS} />
      </div>
      {status.error && !s ? (
        <EmptyState icon="error" title="Session tracking is unavailable" body={status.error} />
      ) : !s ? (
        <EmptyState icon="clock" title="Loading…" loading />
      ) : tab === "live" ? (
        <LiveTab status={s} setStatus={status.set} goTo={setTab} />
      ) : tab === "timeline" ? (
        <TimelineTab initialId={s.activeSession?.id ?? s.lastCompletedId} />
      ) : tab === "history" ? (
        <HistoryTab openId={openId} onOpen={setOpenId} />
      ) : tab === "analytics" ? (
        <AnalyticsTab />
      ) : tab === "settings" ? (
        <SettingsTab status={s} setStatus={status.set} />
      ) : (
        <DiagnosticsTab />
      )}
    </div>
  );
}
