import { useCallback, useEffect, useState } from "react";
import type { GameId } from "@/core/game-context/games";
import { getGameSetting, setGameSetting, type JsonValue } from "@/core/ipc/commands";

/**
 * Reads and writes one per-game setting. Values are validated with `isValid`
 * so corrupted or outdated stored values fall back to the default. The third
 * tuple element is false until the stored value has been read.
 */
export function useGameSetting<T extends JsonValue>(
  game: GameId,
  key: string,
  defaultValue: T,
  isValid: (v: unknown) => v is T,
): [T, (v: T) => void, boolean] {
  const [value, setValue] = useState<T>(defaultValue);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    getGameSetting(game, key)
      .then((v) => !cancelled && setValue(isValid(v) ? v : defaultValue))
      .catch(() => {
        /* outside Tauri: keep default */
      })
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
    // defaultValue/isValid are expected to be stable module-level values.
  }, [game, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    (v: T) => {
      setValue(v);
      setGameSetting(game, key, v).catch((err) => console.warn("Could not save setting", key, err));
    },
    [game, key],
  );

  return [value, update, loaded];
}
