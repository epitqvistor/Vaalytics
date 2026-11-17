import { useEffect } from "react";
import atlasLines from "@/assets/atmosphere/atlas-lines.svg";
import type { GameId } from "@/core/game-context/games";

/**
 * Static atmosphere behind the whole app: key light (per game), etched atlas
 * linework, stone/ash grain and a vignette. Painted once, no animation; it sits
 * outside the scroll containers so scrolling never repaints it.
 */
export function Atmosphere({ game }: { game: GameId | null | undefined }) {
  useEffect(() => {
    const root = document.documentElement;
    if (game) root.dataset.game = game;
    else delete root.dataset.game;
  }, [game]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="atmo-light absolute inset-0" />
      <img
        src={atlasLines}
        alt=""
        draggable={false}
        className="absolute -top-[260px] -right-[220px] w-[980px] max-w-none opacity-[0.07]"
        style={{ maskImage: "radial-gradient(closest-side, black 35%, transparent 100%)" }}
      />
      <img
        src={atlasLines}
        alt=""
        draggable={false}
        className="absolute -bottom-[420px] -left-[360px] w-[900px] max-w-none rotate-[24deg] opacity-[0.035]"
        style={{ maskImage: "radial-gradient(closest-side, black 25%, transparent 90%)" }}
      />
      <div className="atmo-grain absolute inset-0" />
      <div className="atmo-vignette absolute inset-0" />
    </div>
  );
}
