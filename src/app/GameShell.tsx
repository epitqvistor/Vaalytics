import { AnimatePresence, motion } from "motion/react";
import { Suspense, useMemo, useState } from "react";
import { GAME_ART } from "@/assets/games";
import { ActiveGameProvider, useGameContext } from "@/core/game-context/GameContext";
import { GAMES, type GameId } from "@/core/game-context/games";
import type { SectionId } from "@/core/game-context/sections";
import { MODULE_GROUPS, moduleMeta, navigationFor, statusFor, type ModuleMeta } from "@/core/modules/registry";
import { usePreferences } from "@/core/settings/PreferencesContext";
import { DisplayCurrencyProvider } from "@/core/market/DisplayCurrency";
import { LeagueProvider } from "@/core/market/LeagueContext";
import { GAME_MODULES } from "./gameModules";
import { ErrorBoundary, NavItem, PageContext, Spinner } from "@/shared/components";
import { variants } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { viewFor } from "./sections";

export function GameShell({ game }: { game: GameId }) {
  const { prefs } = usePreferences();
  const [section, setSection] = useState<SectionId>("dashboard");
  const nav = useMemo(() => navigationFor(game, { showPlanned: prefs.showPlanned }), [game, prefs.showPlanned]);
  // A hidden planned module (setting turned off) falls back to the dashboard.
  const visible = [...nav.groups.flatMap((g) => g.items), ...nav.footer].some((m) => m.id === section);
  const current: SectionId = visible ? section : "dashboard";
  const Current = viewFor(game, current);
  const meta = moduleMeta(current);
  const page = {
    group: MODULE_GROUPS.find((g) => g.id === meta.group)?.label ?? "Application",
    game: GAMES[game].shortTitle,
    moduleId: current,
  };

  const navItem = (m: ModuleMeta) => (
    <NavItem
      key={m.id}
      icon={m.icon}
      label={m.label}
      active={current === m.id}
      onSelect={() => setSection(m.id)}
      indicatorId="main-nav"
      trailing={statusFor(m.id, game) === "planned" ? <span className="text-[10px] tracking-wide text-fg-subtle uppercase">Soon</span> : undefined}
    />
  );

  return (
    <ActiveGameProvider game={game}>
      <LeagueProvider game={game}>
        <DisplayCurrencyProvider game={game} base={GAME_MODULES[game].config.baseUnit} premium={GAME_MODULES[game].config.premiumUnit}>
          <div className="flex h-full">
            <aside className="glass-nav relative flex w-sidebar shrink-0 flex-col border-r border-line px-3 pt-3 pb-3 shadow-[inset_-1px_0_0_rgb(255_255_255/0.02)]">
              <GameSwitcher game={game} />
              <nav className="mt-4 -mr-1.5 flex flex-col gap-3.5 overflow-y-auto pr-1.5" aria-label="Sections">
                {nav.groups.map((g) => (
                  <div key={g.id}>
                    <p className="mb-1.5 flex items-center gap-2 px-2.5 text-[10px] font-semibold tracking-[0.16em] text-fg-subtle uppercase">
                      {g.label}
                      <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-white/[0.06] to-transparent" />
                    </p>
                    <div className="flex flex-col gap-0.5">{g.items.map(navItem)}</div>
                  </div>
                ))}
              </nav>
              <nav className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3" aria-label="Application">
                {nav.footer.map(navItem)}
              </nav>
            </aside>

            <main className="relative min-w-0 flex-1 overflow-y-auto">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={current} variants={variants.rise} initial="hidden" animate="visible" exit="exit" className="min-h-full px-8 py-7">
                  <Suspense
                    fallback={
                      <div className="flex h-40 items-center justify-center text-fg-subtle">
                        <Spinner />
                      </div>
                    }
                  >
                    <ErrorBoundary resetKey={current}>
                      <PageContext.Provider value={page}>
                        <Current onNavigate={setSection} />
                      </PageContext.Provider>
                    </ErrorBoundary>
                  </Suspense>
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </DisplayCurrencyProvider>
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
