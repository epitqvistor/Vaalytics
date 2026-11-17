import type { ReactNode } from "react";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";
import { Spinner } from "./Spinner";

/** Centered empty / loading / error state. */
export function EmptyState({
  icon,
  title,
  body,
  loading,
  action,
  className,
}: {
  icon: IconName;
  title: string;
  body?: ReactNode;
  loading?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  const tone = icon === "error" ? "text-danger" : icon === "warning" ? "text-warning" : "text-fg-subtle";
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}>
      <span className="mb-1 flex size-10 items-center justify-center rounded-full border border-line bg-white/[0.03]">
        {loading ? <Spinner size={18} className="text-fg-subtle" /> : <Icon name={icon} size={18} className={tone} />}
      </span>
      <p className="text-sm font-medium text-fg">{title}</p>
      {body && <p className="max-w-sm text-xs leading-relaxed text-fg-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Placeholder shimmer-free skeleton block (static; no running animation). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rounded-md bg-white/[0.04]", className)} />;
}
