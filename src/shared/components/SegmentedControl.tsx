import { motion } from "motion/react";
import { useId } from "react";
import { transition } from "@/shared/design/motion";
import { cn } from "@/shared/utilities/cn";

export interface Segment<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  segments: readonly Segment<T>[];
  label: string;
  size?: "sm" | "md";
}

/** Mutually exclusive options (sort order, time range, view mode). */
export function SegmentedControl<T extends string>({ value, onChange, segments, label, size = "md" }: SegmentedControlProps<T>) {
  const layoutId = useId();
  return (
    <div role="radiogroup" aria-label={label} className="well inline-flex rounded-md p-0.5">
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(s.value)}
            className={cn(
              "relative rounded-sm font-medium transition-colors duration-120",
              size === "sm" ? "h-5.5 px-2.5 text-xs" : "h-6.5 px-3 text-sm",
              active ? "text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={transition.layout}
                className="absolute inset-0 rounded-sm border border-line-strong bg-elevated-2"
              />
            )}
            <span className="relative">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
