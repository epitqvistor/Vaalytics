/**
 * App-level Deck Intelligence notifications (PoE 1): a valuable card, screenshot reads that need
 * review or failed, a finished session, a profit milestone. Thresholds come from the module's
 * settings; at most one toast per 2 s. Renders nothing.
 */
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { DECKS_DETECTED_EVENT, type DeckDetectedEvent, getGameSetting } from "@/core/ipc/commands";
import { useToast } from "@/shared/components";
import { formatAmount } from "@/shared/utilities/format";
import { DEFAULT_PREFS, type DeckPrefs, isPrefs, PREFS_KEY } from "./prefs";

export function DeckNotifier() {
  const notify = useToast();
  const ref = useRef(notify);
  ref.current = notify;
  const last = useRef(0);
  const milestone = useRef<{ session: number; done: boolean }>({ session: 0, done: false });
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const prefs = async (): Promise<DeckPrefs> => {
      const v = await getGameSetting("poe1", PREFS_KEY).catch(() => null);
      return isPrefs(v) ? v : DEFAULT_PREFS;
    };
    listen<DeckDetectedEvent>(DECKS_DETECTED_EVENT, async ({ payload }) => {
      const p = await prefs();
      const now = Date.now();
      const say = (tone: "success" | "info" | "warning", title: string, body?: string) => {
        if (now - last.current < 2000) return;
        last.current = now;
        ref.current(tone, title, body);
      };
      if (payload.error) {
        if (p.notifyReview) say("warning", "Deck screenshot not read", payload.error);
        return;
      }
      const best = payload.cards.filter((c) => c.status === "confirmed" && c.unit !== null).sort((a, b) => b.unit! - a.unit!)[0];
      if (p.notifyHighValue !== null && best && best.unit! >= p.notifyHighValue) {
        say("success", `${best.card} drawn`, `≈ ${formatAmount(best.unit!)} c (poe.ninja estimate)`);
      } else if (p.notifyReview && payload.source === "ocr") {
        const review = payload.cards.filter((c) => c.status !== "confirmed").length;
        if (review > 0) say("info", "Cards to review", `${review} of ${payload.cards.length} screenshot entries need a look in Deck Intelligence.`);
        else if (payload.cards.length === 0) say("info", "No cards found in the screenshot", payload.ignored ? `${payload.ignored} other labels ignored.` : undefined);
      }
      // Profit milestone: once per session, only when the cost is known.
      if (p.notifyProfitMilestone !== null && payload.sessionId && payload.sessionValue !== null && payload.sessionCost !== null) {
        if (milestone.current.session !== payload.sessionId) milestone.current = { session: payload.sessionId, done: false };
        const profit = payload.sessionValue - payload.sessionCost;
        if (!milestone.current.done && profit >= p.notifyProfitMilestone) {
          milestone.current.done = true;
          last.current = 0;
          say("success", "Profit milestone reached", `Estimated profit +${formatAmount(profit)} c this session (market estimate, not a sale).`);
        }
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
