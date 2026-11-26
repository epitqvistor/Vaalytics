import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { GAME_ART } from "@/assets/games";
import { useGameContext } from "@/core/game-context/GameContext";
import { GAMES, GAME_IDS, type GameId } from "@/core/game-context/games";
import { getAppSetting } from "@/core/ipc/commands";
import { ease } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";

const DESCRIPTIONS: Record<GameId, { lead: string; features: string[] }> = {
  poe1: {
    lead: "Wraeclast economy, price checks and build tools.",
    features: ["Chaos-based market", "Uniques & maps", "PoB Community"],
  },
  poe2: {
    lead: "Price checks and market data for the new campaign.",
    features: ["Exalted-based market", "Runes & omens", "PoB for PoE 2"],
  },
};

/** Launch screen: choose a game environment. */
export function GameSelection() {
  const { selectGame } = useGameContext();
  const [choosing, setChoosing] = useState<GameId | null>(null);
  const [lastGame, setLastGame] = useState<GameId | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    // Shown as a hint only; the context already clears the active game here.
    getAppSetting<string>("app.lastPlayed")
      .then((v) => (v === "poe1" || v === "poe2") && setLastGame(v))
      .catch(() => {});
  }, []);

  const choose = (id: GameId) => {
    if (choosing) return;
    setChoosing(id);
    window.setTimeout(() => selectGame(id), reduce ? 0 : 320);
  };

  return (
    <div className="relative flex h-full flex-col px-10 pt-10 pb-6">
      <header className="mx-auto mb-8 flex w-full max-w-[1120px] items-end justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.18em] text-accent-2/80 uppercase">Vaalytics</p>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-fg">Choose your game</h1>
        </div>
        <p className="text-sm text-fg-muted">Each game keeps its own leagues, prices and settings.</p>
      </header>

      <div className="mx-auto grid min-h-0 w-full max-w-[1120px] flex-1 grid-cols-2 gap-6">
        {GAME_IDS.map((id, i) => (
          <GameTile
            key={id}
            id={id}
            index={i}
            last={lastGame === id}
            state={choosing == null ? "idle" : choosing === id ? "chosen" : "dimmed"}
            onSelect={() => choose(id)}
          />
        ))}
      </div>

      <footer className="mx-auto mt-6 flex w-full max-w-[1120px] items-center justify-between text-2xs text-fg-subtle">
        <span>Artwork: original Vaalytics artwork · Path of Exile is a trademark of Grinding Gear Games.</span>
        <span>Vaalytics is not affiliated with Grinding Gear Games.</span>
      </footer>
    </div>
  );
}

function GameTile({
  id,
  index,
  last,
  state,
  onSelect,
}: {
  id: GameId;
  index: number;
  last: boolean;
  state: "idle" | "chosen" | "dimmed";
  onSelect: () => void;
}) {
  const game = GAMES[id];
  const art = GAME_ART[id];
  const desc = DESCRIPTIONS[id];
  const ref = useRef<HTMLButtonElement>(null);

  // Pointer position drives a light pool and a slight parallax via CSS vars (no React re-render).
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    el.style.setProperty("--px", `${(e.clientX - r.left) / r.width - 0.5}`);
    el.style.setProperty("--py", `${(e.clientY - r.top) / r.height - 0.5}`);
  };
  const onLeave = () => {
    ref.current?.style.setProperty("--px", "0");
    ref.current?.style.setProperty("--py", "0");
  };

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={onSelect}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      aria-label={`Open ${game.title}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{
        opacity: state === "dimmed" ? 0.35 : 1,
        y: 0,
        scale: state === "chosen" ? 1.015 : state === "dimmed" ? 0.97 : 1,
        transition: { delay: state === "idle" ? 0.06 + index * 0.08 : 0, duration: 0.32, ease: ease.out },
      }}
      className={cn(
        "group relative isolate flex min-h-[420px] flex-col justify-end overflow-hidden rounded-[18px] text-left",
        "shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)] outline-offset-4",
      )}
      style={{ "--px": 0, "--py": 0, "--mx": "50%", "--my": "40%" } as CSSProperties}
    >
      {/* Artwork with hover zoom + parallax */}
      <img
        src={art.art}
        alt=""
        draggable={false}
        decoding="async"
        className="absolute inset-0 -z-20 size-full object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform group-hover:scale-[1.06]"
        style={{
          objectPosition: art.focus,
          translate: "calc(var(--px) * -14px) calc(var(--py) * -10px)",
        }}
      />
      {/* Readability gradient + pointer light */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/90 via-black/35 to-black/10" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: "radial-gradient(520px circle at var(--mx) var(--my), rgb(255 190 130 / 0.14), transparent 60%)" }}
      />
      {/* Lit border */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[18px] border border-white/10 transition-[border-color,box-shadow] duration-300 group-hover:border-white/20 group-hover:shadow-[inset_0_0_0_1px_rgb(242_140_56/0.35),inset_0_1px_0_rgb(255_255_255/0.18)] group-focus-visible:border-accent/60"
      />

      {last && (
        <span className="glass absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-medium text-fg">
          <span className="size-1.5 rounded-full bg-accent" /> Last played
        </span>
      )}

      <div className="relative p-7">
        <span className="glass mb-3 inline-flex rounded-md px-2 py-0.5 text-2xs font-semibold tracking-wide text-accent-2">
          {game.shortTitle}
        </span>
        <h2 className="font-display text-[28px] leading-tight font-semibold tracking-tight text-white transition-transform duration-500 group-hover:-translate-y-0.5">
          {game.title}
        </h2>
        <p className="mt-2 max-w-sm text-sm text-white/70">{desc.lead}</p>
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {desc.features.map((f) => (
            <li key={f} className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-2xs text-white/70 backdrop-blur-sm">
              {f}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex items-center gap-2 text-sm font-medium text-accent-2">
          <span>Enter workspace</span>
          <Icon name="chevronRight" size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
        </div>
      </div>
    </motion.button>
  );
}
