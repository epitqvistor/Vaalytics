import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { GameProvider, useGameContext } from "@/core/game-context/GameContext";
import { GAMES } from "@/core/game-context/games";
import { PreferencesProvider, usePreferences } from "@/core/settings/PreferencesContext";
import { ErrorBoundary, ToastProvider } from "@/shared/components";
import { transition } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { Atmosphere } from "./Atmosphere";
import { GameSelection } from "./GameSelection";
import { GameShell } from "./GameShell";
import { TitleBar } from "./TitleBar";

export function App() {
  return (
    <PreferencesProvider>
      <GameProvider>
        <MotionRoot />
      </GameProvider>
    </PreferencesProvider>
  );
}

function MotionRoot() {
  const { prefs } = usePreferences();
  return (
    // "user" follows the OS setting; the in-app preference can force it on.
    <MotionConfig reducedMotion={prefs.reduceMotion ? "always" : "user"} transition={transition.base}>
      <ToastProvider>
        <div className="relative isolate flex h-full flex-col">
          <AppAtmosphere />
          <AppTitleBar />
          <div className="relative min-h-0 flex-1">
            <ErrorBoundary>
              <Root />
            </ErrorBoundary>
          </div>
        </div>
      </ToastProvider>
    </MotionConfig>
  );
}

function AppAtmosphere() {
  const { game } = useGameContext();
  return <Atmosphere game={game} />;
}

function AppTitleBar() {
  const { game } = useGameContext();
  return (
    <TitleBar>
      {game && (
        <span className="pointer-events-none flex items-center gap-2 text-xs text-fg-subtle">
          <Icon name="chevronRight" size={12} />
          <span className="text-fg-muted">{GAMES[game].title}</span>
        </span>
      )}
    </TitleBar>
  );
}

function Root() {
  const { game } = useGameContext();

  // Persisted selection still loading: render the bare canvas (no spinner flash).
  if (game === undefined) return null;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={game ?? "select"}
        className="absolute inset-0"
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 1.005, transition: transition.exit }}
      >
        {game ? <GameShell game={game} /> : <GameSelection />}
      </motion.div>
    </AnimatePresence>
  );
}
