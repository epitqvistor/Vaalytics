import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/utilities/cn";

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
        <header className="flex h-11 items-center justify-between gap-3 border-b border-line px-4">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

/** Page header used at the top of every section. Deliberately modest in size. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
