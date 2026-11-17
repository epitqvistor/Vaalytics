import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { variants } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";

export type ToastTone = "success" | "info" | "warning" | "error";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

const ICON: Record<ToastTone, { icon: IconName; cls: string }> = {
  success: { icon: "success", cls: "text-success" },
  info: { icon: "info", cls: "text-info" },
  warning: { icon: "warning", cls: "text-warning" },
  error: { icon: "error", cls: "text-danger" },
};

type Notify = (tone: ToastTone, title: string, body?: string) => void;
const Ctx = createContext<Notify>(() => {});

/** Unobtrusive notifications, bottom-right, auto-dismissing. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback<Notify>(
    (tone, title, body) => {
      const id = next.current++;
      setToasts((t) => [...t.slice(-3), { id, tone, title, body }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 7000 : 3500);
    },
    [dismiss],
  );

  const value = useMemo(() => notify, [notify]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-80 flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              variants={variants.pop}
              initial="hidden"
              animate="visible"
              exit="exit"
              role={t.tone === "error" ? "alert" : "status"}
              className="glass-float pointer-events-auto flex items-start gap-3 rounded-lg px-3.5 py-3"
            >
              <Icon name={ICON[t.tone].icon} size={16} className={cn("mt-0.5", ICON[t.tone].cls)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{t.title}</p>
                {t.body && <p className="mt-0.5 text-xs text-fg-muted">{t.body}</p>}
              </div>
              <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-fg-subtle transition-colors hover:text-fg">
                <Icon name="close" size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): Notify {
  return useContext(Ctx);
}
