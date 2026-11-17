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
  /** Shared layoutId so the active indicator glides between items of one nav. */
  indicatorId: string;
  trailing?: ReactNode;
}

export function NavItem({ icon, label, active, onSelect, indicatorId, trailing }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm transition-[color,background-color] duration-150",
        active ? "text-fg" : "text-fg-muted hover:bg-white/[0.04] hover:text-fg",
      )}
    >
      {active && (
        <motion.span
          layoutId={indicatorId}
          transition={transition.layout}
          className="absolute inset-0 overflow-hidden rounded-md border border-white/[0.07] bg-gradient-to-r from-accent/[0.13] via-white/[0.04] to-white/[0.02] shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]"
        >
          {/* Accent edge inside the pill (never clipped by the scrolling nav). */}
          <span className="absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_8px_rgb(242_140_56/0.6)]" />
        </motion.span>
      )}
      <Icon name={icon} className={cn("relative transition-colors", active ? "text-accent-2" : "text-fg-subtle group-hover:text-fg-muted")} />
      <span className="relative flex-1 text-left">{label}</span>
      {trailing && <span className="relative">{trailing}</span>}
    </button>
  );
}
