/**
 * App-level listener: when a PoE 2 session completes and the user turned on
 * "Notify when a session ends" (off by default), shows an in-app notification
 * with the summary. Mounted once in the app shell; renders nothing.
 */
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { SESSION_COMPLETED_EVENT, sessionDetail, type SessionCompletedEvent } from "@/core/ipc/commands";
import { useToast } from "@/shared/components";
import { dur } from "./stats";

export function SessionNotifier() {
  const notify = useToast();
  const ref = useRef(notify);
  ref.current = notify;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<SessionCompletedEvent>(SESSION_COMPLETED_EVENT, ({ payload }) => {
      if (!payload.notify || payload.game !== "poe2") return;
      sessionDetail("poe2", payload.sessionId)
        .then((r) => {
          if (!r) return;
          const s = r.detail.summary;
          const maps = s.logTracked ? ` · ${s.mapsEntered} map${s.mapsEntered === 1 ? "" : "s"}` : "";
          ref.current("info", "Session saved", `${dur(s.durationSecs)}${maps}. The summary is in Session Intelligence.`);
        })
        .catch((e) => ref.current("warning", "Session saved", `The summary couldn't be loaded: ${String(e)}`));
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
