import { motion } from "motion/react";
import type { ReactNode } from "react";
import { transition } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";

export interface NavItemProps {
  icon: IconName;
  label: string;
  active: boolean;
  onSelect: () => void;
  /** Shared layoutId so the active marker glides between items of one nav. */
  indicatorId: string;
  trailing?: ReactNode;
}

/**
 * Sidebar item. Active = brighter text on a faint tint with the stepped bronze
 * marker (`vaal-step`) on the left edge; no pill, no glow.
 */
export function NavItem({ icon, label, active, onSelect, indicatorId, trailing }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-8 w-full items-center gap-2.5 rounded-sm pr-2 pl-3 text-sm transition-colors duration-120",
        active ? "bg-glass-strong text-fg" : "text-fg-muted hover:bg-glass hover:text-fg",
      )}
    >
      {active && <motion.span layoutId={indicatorId} transition={transition.layout} aria-hidden className="vaal-step absolute top-1.5 bottom-1.5 left-0" />}
      <Icon name={icon} className={cn("shrink-0 transition-colors duration-120", active ? "text-accent-2" : "text-fg-subtle group-hover:text-fg-muted")} />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
  );
}
