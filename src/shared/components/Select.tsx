import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { duration, ease } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  label?: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Listbox dropdown. Rendered in a portal (panels clip overflow) and positioned
 * against the trigger. Keyboard: ↑/↓, Home/End, Enter/Space, Esc, type-ahead.
 */
export function Select<T extends string>({ value, onChange, options, label, hideLabel, size = "md", className }: SelectProps<T>) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const typed = useRef({ text: "", at: 0 });
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[selectedIndex];

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = Math.min(320, options.length * 32 + 8);
    const up = r.bottom + menuH + 8 > window.innerHeight && r.top > menuH + 8;
    setRect({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: Math.max(r.width, 160), up });
  }, [options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    setActive(selectedIndex);
  }, [open, place, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const commit = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => Math.min(options.length - 1, a + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        break;
      case "Escape":
      case "Tab":
        setOpen(false);
        break;
      default:
        if (e.key.length === 1) {
          const now = Date.now();
          typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
          const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
          if (i >= 0) setActive(i);
        }
    }
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <span id={`${id}-label`} className={cn("text-xs font-medium text-fg-muted", hideLabel && "sr-only")}>
          {label}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={label ? `${id}-label` : undefined}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md border bg-elevated/85 pr-2 pl-2.5 text-left text-fg transition-[border-color,background-color,box-shadow] duration-150",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.045),0_1px_1px_rgb(0_0_0/0.25)] hover:border-line-strong hover:bg-elevated-2",
          open ? "border-accent/60 shadow-[0_0_0_3px_var(--color-accent-soft)]" : "border-line",
          size === "sm" ? "h-7 text-xs" : "h-8.5 text-sm",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? "—"}</span>
        <Icon name="chevronDown" size={14} className={cn("shrink-0 text-fg-subtle transition-transform duration-200", open && "rotate-180 text-fg-muted")} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && rect && (
            <motion.ul
              ref={listRef}
              id={`${id}-list`}
              role="listbox"
              aria-labelledby={label ? `${id}-label` : undefined}
              initial={{ opacity: 0, y: rect.up ? 4 : -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: duration.fast, ease: ease.out } }}
              exit={{ opacity: 0, y: rect.up ? 2 : -2, transition: { duration: 0.1, ease: ease.in } }}
              style={{
                position: "fixed",
                left: rect.left,
                width: rect.width,
                ...(rect.up ? { bottom: window.innerHeight - rect.top } : { top: rect.top }),
                transformOrigin: rect.up ? "bottom" : "top",
              }}
              className="glass-float z-[60] max-h-80 overflow-y-auto rounded-lg p-1"
            >
              {options.map((o, i) => {
                const selected = o.value === value;
                return (
                  <li
                    key={o.value}
                    id={`${id}-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={selected}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => commit(i)}
                    className={cn(
                      "flex h-8 cursor-default items-center gap-2 rounded-md px-2.5 text-sm transition-colors duration-100",
                      i === active ? "bg-white/[0.065] text-fg" : "text-fg-muted",
                      selected && "font-medium text-fg",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {selected && <Icon name="check" size={14} className="text-accent-2" />}
                  </li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
