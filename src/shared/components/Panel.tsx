import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/utilities/cn";
import { usePageContext } from "./PageContext";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** `solid` for data (default); `glass` (legacy name) is the quieter chrome surface. */
  surface?: "solid" | "glass";
  title?: ReactNode;
  /** Short secondary text after the title (source, unit, period). */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Remove body padding (tables, lists). */
  flush?: boolean;
}

export function Panel({ surface = "solid", title, meta, actions, flush, className, children, ...rest }: PanelProps) {
  return (
    <section className={cn("overflow-hidden rounded-lg", surface === "glass" ? "glass" : "panel", className)} {...rest}>
      {(title || actions) && (
        <header className="flex h-10 items-center justify-between gap-3 border-b border-line px-4">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h2 className="truncate text-sm font-semibold text-fg">{title}</h2>
            {meta && <span className="truncate text-xs text-fg-subtle">{meta}</span>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5 text-xs text-fg-muted">{actions}</div>}
        </header>
      )}
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

/**
 * Page header at the top of every section: where you are ("Economy · PoE 1",
 * led by the bronze lintel, one of the few Vaal marks), a modest title, the
 * page's contextual controls on the right, and a hairline below.
 */
export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  const ctx = usePageContext();
  const brow = eyebrow ?? [ctx.group, ctx.game].filter(Boolean).join(" · ");
  return (
    <div className="mb-5 border-b border-line pb-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {brow && (
            <p className="mb-1.5 flex items-center gap-2 text-xs text-fg-subtle">
              <span aria-hidden className="vaal-lintel" />
              {brow}
            </p>
          )}
          <h1 className="font-display text-xl font-semibold tracking-[-0.01em] text-fg">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
