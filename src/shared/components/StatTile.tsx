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
}

export function StatTile({ label, value, unit, change, caption }: StatTileProps) {
  const dir = change == null ? null : change > 0.0005 ? "up" : change < -0.0005 ? "down" : "flat";
  return (
    <div className="panel flex flex-col rounded-lg px-4 py-3.5">
      <span className="text-xs text-fg-muted">{label}</span>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="tabular font-display text-2xl font-semibold tracking-tight text-fg">{value}</span>
        {unit && <span className="text-sm text-fg-muted">{unit}</span>}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {dir && <ChangeText change={change!} />}
        {caption && <span className="text-fg-subtle">{caption}</span>}
      </div>
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
