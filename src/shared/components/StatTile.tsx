import type { ReactNode } from "react";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { formatChange } from "@/shared/utilities/format";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  unit?: string;
  /** Ratio, e.g. 0.042. Shown with sign + arrow so it never relies on colour alone. */
  change?: number;
  caption?: ReactNode;
  /** Leading visual (e.g. item icon) next to the label. */
  icon?: ReactNode;
  className?: string;
}

/** A headline figure on its own raised surface. */
export function StatTile({ className, ...stat }: StatTileProps) {
  return <Stat {...stat} className={cn("panel-raised led-edge rounded-lg", className)} />;
}

/**
 * A headline figure without a surface, for strips of related figures (see the
 * Dashboard): label, value (+ unit), then change and context, in falling order of weight.
 */
export function Stat({ label, value, unit, change, caption, icon, className }: StatTileProps) {
  return (
    <div className={cn("flex min-w-0 flex-col px-4 pt-3 pb-3", className)}>
      <span className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="tabular font-display text-2xl font-semibold tracking-[-0.01em] text-fg">{value}</span>
        {unit && <span className="text-sm text-fg-subtle">{unit}</span>}
      </div>
      {(change != null || caption) && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          {change != null && <ChangeText change={change} />}
          {caption && <span className="text-fg-subtle">{caption}</span>}
        </div>
      )}
    </div>
  );
}

export function ChangeText({ change, className }: { change: number; className?: string }) {
  const dir = change > 0.0005 ? "up" : change < -0.0005 ? "down" : "flat";
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-0.5 font-medium",
        dir === "up" ? "text-success" : dir === "down" ? "text-danger" : "text-fg-muted",
        className,
      )}
    >
      {dir !== "flat" && <Icon name={dir === "up" ? "chevronUp" : "chevronDown"} size={12} />}
      {formatChange(change)}
    </span>
  );
}
