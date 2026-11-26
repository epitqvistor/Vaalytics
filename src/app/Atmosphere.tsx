import { useEffect } from "react";
import type { GameId } from "@/core/game-context/games";
import { usePreferences } from "@/core/settings/PreferencesContext";

/*
 * Original line drawing of a stepped Vaal pyramid: seven terraces with a carved
 * course line each, a central stair and a shrine on top. Drawn once; the whole
 * figure sits at very low opacity behind content (panels stay solid).
 */
const W = 1000;
const H = 620;
const STEPS = 7;
const STEP_H = 56;
const INSET = 52;
const STAIR = 34;

function templePath(): string {
  const d: string[] = [];
  for (let i = 0; i < STEPS; i++) {
    const x = 50 + i * INSET;
    const w = 900 - i * INSET * 2;
    const y = H - (i + 1) * STEP_H;
    d.push(`M${x} ${y + STEP_H}V${y}H${x + w}V${y + STEP_H}`);
    // Carved course line just below each terrace edge.
    d.push(`M${x + 10} ${y + 11}H${x + w - 10}`);
  }
  const top = H - STEPS * STEP_H;
  // Central stair: two strings and treads every 14 px.
  d.push(`M${W / 2 - STAIR} ${H}V${top}M${W / 2 + STAIR} ${H}V${top}`);
  for (let y = H - 14; y > top; y -= 14) d.push(`M${W / 2 - STAIR} ${y}H${W / 2 + STAIR}`);
  // Shrine with a doorway.
  d.push(`M${W / 2 - 70} ${top}V${top - 70}H${W / 2 + 70}V${top}`);
  d.push(`M${W / 2 - 84} ${top - 70}H${W / 2 + 84}`);
  d.push(`M${W / 2 - 18} ${top}V${top - 42}H${W / 2 + 18}V${top}`);
  return d.join("");
}
const TEMPLE = templePath();

/**
 * Static-first background behind the whole app: obsidian tonal base, the Vaal
 * pyramid linework (fades in once) and one warm light that
 * slowly breathes (transform/opacity only, composited by the GPU). The light is
 * still when the window is hidden, when Settings → Reduce motion is on, or when
 * Windows asks for reduced motion. Also marks the active game on <html data-game>.
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
      <div className="atmo-glow absolute" />
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMaxYMax meet" className="atmo-temple absolute right-[-3%] bottom-0 h-[72%] max-h-[720px] w-auto">
        <defs>
          {/* Fade towards the top in the stroke itself: a CSS mask here re-rasters every frame. */}
          <linearGradient id="atmo-temple-fade" x1="0" y1={H} x2="0" y2={0} gradientUnits="userSpaceOnUse">
            <stop offset="0.25" stopColor="currentColor" stopOpacity="1" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={TEMPLE} fill="none" stroke="url(#atmo-temple-fade)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
