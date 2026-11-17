import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/utilities/cn";
import { usePageContext } from "./PageContext";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** `solid` for data (default), `glass` for chrome/hero areas only. */
  surface?: "solid" | "glass";
  title?: ReactNode;
  actions?: ReactNode;
  /** Remove body padding (tables, lists). */
  flush?: boolean;
}

export function Panel({ surface = "solid", title, actions, flush, className, children, ...rest }: PanelProps) {
  return (
    <section className={cn("overflow-hidden rounded-lg", surface === "glass" ? "glass" : "panel", className)} {...rest}>
      {(title || actions) && (
        <header className="flex h-11 items-center justify-between gap-3 border-b border-line bg-gradient-to-b from-white/[0.025] to-transparent px-4">
          <h2 className="text-sm font-semibold tracking-[-0.005em] text-fg">{title}</h2>
          {actions && <div className="flex items-center gap-1.5 text-xs text-fg-muted">{actions}</div>}
        </header>
      )}
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

/**
 * Page header used at the top of every section: an eyebrow with where you are
 * ("Market · PoE 1"), a modest title, and a fading hairline ornament below.
 */
export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  const ctx = usePageContext();
  const brow = eyebrow ?? [ctx.group, ctx.game].filter(Boolean).join(" · ");
  return (
    <div className="mb-6">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {brow && (
            <p className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.16em] text-accent-2/75 uppercase">
              <span aria-hidden className="size-1.5 rotate-45 border border-accent/70" />
              {brow}
            </p>
          )}
          <h1 className="font-display text-[22px] leading-7 font-semibold tracking-[-0.015em] text-fg">{title}</h1>
          {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div aria-hidden className="ornament-rule mt-4" />
    </div>
  );
}
