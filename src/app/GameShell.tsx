import { AnimatePresence, motion } from "motion/react";
import { Suspense, useState } from "react";
import { GAME_ART } from "@/assets/games";
import { ActiveGameProvider, useGameContext } from "@/core/game-context/GameContext";
import { GAMES, type GameId } from "@/core/game-context/games";
import { NAV_GROUPS, SECTION_META, type SectionId } from "@/core/game-context/sections";
import { LeagueProvider } from "@/core/market/LeagueContext";
import { ErrorBoundary, NavItem, Spinner } from "@/shared/components";
import { variants } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { SECTIONS } from "./sections";

export function GameShell({ game }: { game: GameId }) {
  const [section, setSection] = useState<SectionId>("dashboard");
  const Current = SECTIONS[game][section];

  const navItem = (id: SectionId) => (
    <NavItem
      key={id}
      icon={SECTION_META[id].icon}
      label={SECTION_META[id].label}
      active={section === id}
      onSelect={() => setSection(id)}
      indicatorId="main-nav"
      trailing={SECTION_META[id].plannedFor?.includes(game) ? <span className="text-[10px] tracking-wide text-fg-subtle uppercase">Soon</span> : undefined}
    />
  );

  return (
    <ActiveGameProvider game={game}>
      <LeagueProvider game={game}>
        <div className="flex h-full">
          <aside className="glass-nav relative flex w-sidebar shrink-0 flex-col border-r border-line px-3 pt-3 pb-3">
            <GameSwitcher game={game} />
            <nav className="mt-4 flex flex-col gap-4 overflow-y-auto" aria-label="Sections">
              {NAV_GROUPS.map((g) => (
                <div key={g.label}>
                  <p className="mb-1 px-2.5 text-[10px] font-semibold tracking-[0.14em] text-fg-subtle uppercase">{g.label}</p>
                  <div className="flex flex-col gap-0.5">{g.items.map(navItem)}</div>
                </div>
              ))}
            </nav>
            <nav className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3" aria-label="Application">
              {navItem("settings")}
            </nav>
          </aside>

          <main className="relative min-w-0 flex-1 overflow-y-auto">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={section} variants={variants.rise} initial="hidden" animate="visible" exit="exit" className="min-h-full px-8 py-7">
                <Suspense
                  fallback={
                    <div className="flex h-40 items-center justify-center text-fg-subtle">
                      <Spinner />
                    </div>
                  }
                >
                  <ErrorBoundary resetKey={section}>
                    <Current onNavigate={setSection} />
                  </ErrorBoundary>
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </LeagueProvider>
    </ActiveGameProvider>
  );
}

/** Current game identity with artwork; click to return to game selection. */
function GameSwitcher({ game }: { game: GameId }) {
  const { clearGame } = useGameContext();
  const art = GAME_ART[game];
  return (
    <button
      type="button"
      onClick={clearGame}
      title="Switch game"
      className="group relative isolate flex h-[72px] items-end overflow-hidden rounded-lg border border-white/10 p-3 text-left transition-[border-color,transform] duration-200 hover:-translate-y-px hover:border-white/20"
    >
      <img
        src={art.art}
        alt=""
        draggable={false}
        className="absolute inset-0 -z-20 size-full object-cover transition-transform duration-700 group-hover:scale-105"
        style={{ objectPosition: art.focus }}
      />
      <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-black/85 via-black/55 to-black/20" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold tracking-wide text-accent-2">{GAMES[game].shortTitle}</span>
        <span className="block truncate text-sm font-semibold text-white">{GAMES[game].title}</span>
      </span>
      <span className="glass flex size-7 items-center justify-center rounded-md text-white/80 transition-colors group-hover:text-white">
        <Icon name="swap" size={14} />
      </span>
    </button>
  );
}
