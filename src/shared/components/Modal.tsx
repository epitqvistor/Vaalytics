import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { variants } from "@/shared/design/motion";
import { cn } from "@/shared/utilities/cn";
import { IconButton } from "./Button";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

/**
 * Accessible modal dialog: focus moves in on open, Tab is trapped, Escape and
 * backdrop click close it, and focus returns to the trigger on close.
 */
export function Modal({ open, onClose, title, description, children, footer, size = "md" }: ModalProps) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <ModalInner onClose={onClose} title={title} description={description} footer={footer} size={size}>
          {children}
        </ModalInner>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function ModalInner({ onClose, title, description, children, footer, size = "md" }: Omit<ModalProps, "open">) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <motion.div
        className="absolute inset-0 bg-black/60"
        variants={variants.fade}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={() => onCloseRef.current()}
        aria-hidden
      />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        variants={variants.pop}
        initial="hidden"
        animate="visible"
        exit="exit"
        className={cn("glass-float relative w-full overflow-hidden rounded-xl", widths[size])}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-base font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-fg-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton icon="close" label="Close" size="sm" onClick={() => onCloseRef.current()} className="-mr-1.5 -mt-1" />
        </div>
        {children && <div className="px-5 pt-4">{children}</div>}
        <div className="mt-5 flex justify-end gap-2 border-t border-line bg-bg-2 px-5 py-3">{footer}</div>
      </motion.div>
    </div>
  );
}
