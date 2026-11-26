/**
 * Update Center hooks. Event-driven: no polling. The overview reloads when a run reports
 * progress/finishes or a dataset changes; views reload their own lists on the same events.
 */
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  UPDATES_DATASET_CHANGED_EVENT,
  UPDATES_FINISHED_EVENT,
  UPDATES_PROGRESS_EVENT,
  updatesOverview,
  type UpdOverview,
  type UpdProgress,
  type UpdReport,
} from "@/core/ipc/commands";

/** Subscribes to one Tauri event for the lifetime of the component. */
export function useTauriEvent<T>(name: string, onEvent: (payload: T) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<T>(name, ({ payload }) => cb.current(payload))
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(() => {
        /* outside Tauri */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [name]);
}

/** Calls `onChange` when any of `datasetIds` gets a new installed version (apply, rollback, import). */
export function useDatasetChanged(datasetIds: readonly string[], onChange: () => void) {
  const key = datasetIds.join("|");
  const cb = useRef(onChange);
  cb.current = onChange;
  useTauriEvent<{ datasetId: string }>(UPDATES_DATASET_CHANGED_EVENT, (p) => {
    if (key.split("|").includes(p.datasetId)) cb.current();
  });
}

export function useUpdateCenter() {
  const [overview, setOverview] = useState<UpdOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdProgress | null>(null);
  const [lastReport, setLastReport] = useState<UpdReport | null>(null);
  const [revision, setRevision] = useState(0);

  const reload = useCallback(() => {
    updatesOverview()
      .then((o) => {
        setOverview(o);
        setProgress(o.running);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(reload, [reload]);

  useTauriEvent<UpdProgress>(UPDATES_PROGRESS_EVENT, setProgress);
  useTauriEvent<UpdReport>(UPDATES_FINISHED_EVENT, (r) => {
    setProgress(null);
    setLastReport(r);
    setRevision((n) => n + 1);
    reload();
  });
  useTauriEvent<unknown>(UPDATES_DATASET_CHANGED_EVENT, () => {
    setRevision((n) => n + 1);
    reload();
  });

  /** Lists in tabs depend on this; bump after a local action too. */
  const bump = useCallback(() => {
    setRevision((n) => n + 1);
    reload();
  }, [reload]);

  return { overview, error, progress, lastReport, setLastReport, revision, reload, bump };
}

export type UpdateCenter = ReturnType<typeof useUpdateCenter>;
