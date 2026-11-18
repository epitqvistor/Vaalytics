/**
 * App-level pieces of Loot Journal: in-app notifications for captures the user
 * asked to hear about (all off by default), and the capture indicator shown in
 * the title bar while PoE 2 is the selected game. Render nothing else.
 */
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { LOOT_CAPTURED_EVENT, type LootCapturedEvent } from "@/core/ipc/commands";
import { useToast } from "@/shared/components";
import { cn } from "@/shared/utilities/cn";
import { formatAmount } from "@/shared/utilities/format";
import { useLootStatus } from "./hooks";

const REASON: Record<string, string> = { valuable: "Valuable item captured", unique: "Unique item captured", captured: "Item captured" };

export function LootNotifier() {
  const notify = useToast();
  const ref = useRef(notify);
  ref.current = notify;
  const last = useRef(0);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<LootCapturedEvent>(LOOT_CAPTURED_EVENT, ({ payload }) => {
      // At most one notification per 2 s, so a burst of copies doesn't spam.
      const now = Date.now();
      if (now - last.current < 2000) return;
      if ("error" in payload) {
        last.current = now;
        ref.current("warning", "Loot capture failed", payload.error);
      } else if ("valueChange" in payload) {
        last.current = now;
        ref.current("info", "Market value changed", `${formatAmount(payload.valueChange.from)} → ${formatAmount(payload.valueChange.to)} ex (Loot Journal)`);
      } else if (payload.notify) {
        last.current = now;
        const value = payload.valueTotal !== null ? ` · ${formatAmount(payload.valueTotal)} ex` : "";
        ref.current("success", REASON[payload.notify] ?? "Item captured", `${payload.name}${value}`);
      }
    })
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(() => {
        /* outside Tauri */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return null;
}

/** Small title-bar indicator: visible whenever automatic loot capture is enabled. */
export function LootCaptureIndicator() {
  const s = useLootStatus();
  if (!s?.enabled) return null;
  return (
    <span
      className="pointer-events-none flex items-center gap-1.5 text-2xs text-fg-subtle"
      title={s.listening ? "Loot capture is listening: Ctrl+C on an item in Path of Exile 2 saves it to Loot Journal." : "Loot capture is on; it listens only while Path of Exile 2 is the active window."}
    >
      <span className={cn("size-1.5 rounded-full", s.listening ? "bg-success" : "bg-fg-subtle/60")} />
      Loot capture {s.listening ? "listening" : "on"}
    </span>
  );
}
