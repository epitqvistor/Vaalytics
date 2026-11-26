import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useActiveGame } from "@/core/game-context/GameContext";
import type { SectionProps } from "@/core/game-context/sections";
import {
  BROWSER_EVENT,
  browserAction,
  browserClose,
  browserOpen,
  browserOpenExternal,
  browserSetBounds,
  browserShowOnly,
  type BrowserEvent,
} from "@/core/ipc/commands";
import { IconButton, Spinner, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";
import { hostOf, toUrl } from "./address";
import { POE_LINKS } from "./links";

// ---------- tab store (survives leaving and re-entering the section) ----------

interface Tab {
  id: string;
  url: string | null;
  title: string | null;
  loading: boolean;
  /** A native webview exists for this tab. */
  live: boolean;
}

let nextId = 1;
const newTab = (): Tab => ({ id: `t${nextId++}`, url: null, title: null, loading: false, live: false });
let state: { tabs: Tab[]; active: string } = (() => {
  const t = newTab();
  return { tabs: [t], active: t.id };
})();
const subs = new Set<() => void>();
const store = {
  get: () => state,
  set(fn: (s: typeof state) => typeof state) {
    state = fn(state);
    subs.forEach((f) => f());
  },
  sub(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  patch(id: string, p: Partial<Tab>) {
    store.set((s) => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...p } : t)) }));
  },
};
const useBrowser = () => useSyncExternalStore(store.sub, store.get);

// ---------- view ----------

export default function BrowserView(_props: SectionProps) {
  const game = useActiveGame();
  const notify = useToast();
  const { tabs, active } = useBrowser();
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]!;
  const areaRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);

  const bounds = useCallback(() => {
    const r = areaRef.current?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
  }, []);

  const navigate = useCallback(
    async (tabId: string, url: string) => {
      const b = bounds();
      if (!b) return;
      store.patch(tabId, { url, loading: true, live: true });
      try {
        await browserOpen(tabId, url, b);
        await browserShowOnly(tabId);
      } catch (e) {
        store.patch(tabId, { loading: false });
        notify("warning", "Couldn't open page", String(e));
      }
    },
    [bounds, notify],
  );

  // Native page events → tab state.
  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false; // unlisten even if cleanup runs before listen() resolves
    listen<BrowserEvent>(BROWSER_EVENT, ({ payload: e }) => {
      if (e.kind === "navigated") store.patch(e.tab, { url: e.url });
      else if (e.kind === "loading") store.patch(e.tab, { loading: e.loading, url: e.url });
      else if (e.kind === "title") store.patch(e.tab, { title: e.title || null });
      else if (e.kind === "newTab") {
        const t = newTab();
        store.set((s) => ({ tabs: [...s.tabs, t], active: t.id }));
        void navigate(t.id, e.url);
      }
    }).then((u) => (disposed ? u() : (un = u)));
    return () => {
      disposed = true;
      un?.();
    };
  }, [navigate]);

  // Show only the active tab's page while this section is visible; hide all when leaving.
  useEffect(() => {
    void browserShowOnly(tab.live ? tab.id : null);
  }, [tab.id, tab.live]);
  useEffect(() => () => void browserShowOnly(null), []);

  // Keep the native page glued to the content area (resize, and after the page-enter animation).
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const sync = () => {
      const b = bounds();
      const t = store.get().tabs.find((x) => x.id === store.get().active);
      if (b && t?.live) void browserSetBounds(t.id, b);
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    const late = window.setTimeout(sync, 320);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.clearTimeout(late);
    };
  }, [bounds, tab.id]);

  useEffect(() => {
    if (!editing) setAddress(tab.url ?? "");
  }, [tab.url, editing]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = toUrl(address);
    if (!url) return notify("warning", "Can't open that address", "Only web addresses (http/https) or search terms.");
    setEditing(false);
    (document.activeElement as HTMLElement | null)?.blur();
    void navigate(tab.id, url);
  };

  const addTab = () => {
    const t = newTab();
    store.set((s) => ({ tabs: [...s.tabs, t], active: t.id }));
  };

  const closeTab = (id: string) => {
    void browserClose(id);
    store.set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      let tabs = s.tabs.filter((t) => t.id !== id);
      if (tabs.length === 0) tabs = [newTab()];
      const active = s.active === id ? tabs[Math.max(0, i - 1)]!.id : s.active;
      return { tabs, active };
    });
  };

  const goHome = () => {
    void browserClose(tab.id);
    store.patch(tab.id, { url: null, title: null, loading: false, live: false });
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-var(--spacing-titlebar)-56px)] max-w-page flex-col">
      <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg">
        {/* Tabs */}
        <div className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-line bg-bg-2/80 px-2" role="tablist" aria-label="Browser tabs">
          <AnimatePresence initial={false}>
            {tabs.map((t) => (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className={cn(
                  "group flex h-8 w-48 shrink-0 items-center gap-2 rounded-t-md border border-b-0 px-2.5 text-xs transition-colors",
                  t.id === active ? "border-line bg-surface text-fg" : "border-transparent text-fg-muted hover:bg-glass-hover hover:text-fg",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={t.id === active}
                  onClick={() => store.set((s) => ({ ...s, active: t.id }))}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={t.url ?? "Start page"}
                >
                  {t.loading ? <Spinner size={12} /> : <Icon name="browser" size={13} className="shrink-0 text-fg-subtle" />}
                  <span className="truncate">{t.title ?? hostOf(t.url)}</span>
                </button>
                <button
                  type="button"
                  aria-label="Close tab"
                  onClick={() => closeTab(t.id)}
                  className="rounded p-0.5 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
                >
                  <Icon name="close" size={12} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          <IconButton icon="plus" label="New tab" size="sm" onClick={addTab} className="mb-0.5" />
        </div>

        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
          <IconButton icon="chevronLeft" label="Back" size="sm" disabled={!tab.live} onClick={() => browserAction(tab.id, "back")} />
          <IconButton icon="chevronRight" label="Forward" size="sm" disabled={!tab.live} onClick={() => browserAction(tab.id, "forward")} />
          <IconButton icon="refresh" label="Reload" size="sm" disabled={!tab.live} onClick={() => browserAction(tab.id, "reload")} />
          <IconButton icon="dashboard" label="Start page" size="sm" onClick={goHome} />
          <form onSubmit={submit} className="ml-1 flex min-w-0 flex-1">
            <label className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-well px-2.5 text-xs transition-colors duration-120 hover:border-line-strong focus-within:border-copper">
              <Icon name={tab.url?.startsWith("https://") ? "check" : "search"} size={13} className="shrink-0 text-fg-subtle" />
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onFocus={(e) => {
                  setEditing(true);
                  e.currentTarget.select();
                }}
                onBlur={() => setEditing(false)}
                placeholder="Search Google or enter an address"
                spellCheck={false}
                aria-label="Address"
                className="min-w-0 flex-1 bg-transparent text-fg placeholder:text-fg-subtle focus-visible:outline-none"
              />
            </label>
          </form>
          <IconButton
            icon="external"
            label="Open in your default browser (use this if a sign-in page refuses embedded browsers)"
            size="sm"
            disabled={!tab.live}
            onClick={() => browserOpenExternal(tab.id).catch((e) => notify("warning", "Couldn't open", String(e)))}
          />
        </div>

        {/* Page area: the native webview is positioned exactly over this element. */}
        <div ref={areaRef} className="relative min-h-0 flex-1">
          {!tab.live && <StartPage game={game} onOpen={(url) => navigate(tab.id, url)} />}
        </div>
      </div>
    </div>
  );
}

function StartPage({ game, onOpen }: { game: "poe1" | "poe2"; onOpen: (url: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-10">
      <div className="grid w-full max-w-2xl grid-cols-3 gap-3">
        {POE_LINKS[game].map((l) => (
          <QuickLink key={l.url} {...l} onOpen={() => onOpen(l.url)} />
        ))}
      </div>
      <div className="mt-8 flex max-w-2xl gap-3 rounded-lg border border-line bg-bg-2/70 px-4 py-3 text-xs text-fg-muted">
        <Icon name="info" size={16} className="mt-px shrink-0 text-info" />
        <p>
          Sign in on pathofexile.com itself — Vaalytics never sees your password, and websites can't use Vaalytics features. Your session is kept
          between launches. If a sign-in provider refuses embedded browsers, use <Icon name="external" size={12} className="inline align-[-2px]" /> to
          continue in your default browser.
        </p>
      </div>
    </div>
  );
}

function QuickLink({ title, host, icon, onOpen }: { title: string; host: string; url: string; icon: IconName; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group panel flex flex-col gap-2.5 rounded-lg px-4 py-3.5 text-left transition-[transform,border-color] duration-150 hover:-translate-y-0.5"
    >
      <span className="flex size-8 items-center justify-center rounded-md bg-accent-soft text-accent-2">
        <Icon name={icon} size={16} />
      </span>
      <span>
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block text-2xs text-fg-subtle">{host}</span>
      </span>
    </button>
  );
}
