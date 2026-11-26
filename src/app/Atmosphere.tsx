import { useEffect } from "react";
import type { GameId } from "@/core/game-context/games";
import { usePreferences } from "@/core/settings/PreferencesContext";

/**
 * Background behind the whole app, minimal and full-bleed: an obsidian tonal base,
 * a faint pattern of Vaal masonry (stone courses with staggered joints) over the
 * entire panel, a static edge shade, and one soft warm light that slowly drifts
 * across the stone. Only the light moves (transform/opacity in small steps, see
 * index.css); it is still when the window is hidden, with Settings → Reduce motion
 * or Windows reduced motion. Also marks the active game on <html data-game>.
 */
export function Atmosphere({ game }: { game: GameId | null | undefined }) {
  const { prefs } = usePreferences();

  useEffect(() => {
    const root = document.documentElement;
    if (game) root.dataset.game = game;
    else delete root.dataset.game;
  }, [game]);

  useEffect(() => {
    const root = document.documentElement;
    if (prefs.reduceMotion) root.dataset.motion = "reduced";
    else delete root.dataset.motion;
  }, [prefs.reduceMotion]);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => (document.hidden ? (root.dataset.hidden = "") : delete root.dataset.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="atmo-base absolute inset-0" />
      <div className="atmo-masonry absolute inset-0" />
      <div className="atmo-shade absolute inset-0" />
      <div className="atmo-light absolute" />
    </div>
  );
}
