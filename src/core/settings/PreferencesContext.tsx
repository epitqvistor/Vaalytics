import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getAppSetting, setAppSetting } from "@/core/ipc/commands";

/** App-wide UI preferences, persisted in `app_settings`. */
export interface Preferences {
  /** Force reduced motion regardless of the OS setting. */
  reduceMotion: boolean;
  /** Show modules that are registered but not built yet in navigation. */
  showPlanned: boolean;
}

const DEFAULTS: Preferences = { reduceMotion: false, showPlanned: true };
const KEYS: { [K in keyof Preferences]: string } = { reduceMotion: "ui.reduceMotion", showPlanned: "ui.showPlannedModules" };

interface PreferencesValue {
  prefs: Preferences;
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
}

const Ctx = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    for (const key of Object.keys(KEYS) as (keyof Preferences)[]) {
      getAppSetting<boolean>(KEYS[key])
        .then((v) => !cancelled && typeof v === "boolean" && setPrefs((p) => ({ ...p, [key]: v })))
        .catch(() => {
          /* outside Tauri or DB unavailable: keep defaults */
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const setPref = useCallback(<K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    setAppSetting(KEYS[key], value).catch((err) => console.warn("Could not save preference", key, err));
  }, []);

  const value = useMemo(() => ({ prefs, setPref }), [prefs, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePreferences must be used inside <PreferencesProvider>");
  return ctx;
}
