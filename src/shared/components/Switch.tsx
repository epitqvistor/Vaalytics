import { motion } from "motion/react";
import { useId } from "react";
import { transition } from "@/shared/design/motion";
import { cn } from "@/shared/utilities/cn";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const id = useId();
  return (
    <div className={cn("flex items-center justify-between gap-3", disabled && "opacity-50")}>
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm text-fg">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-4.5 w-8 shrink-0 items-center rounded-sm border p-0.5 transition-colors duration-120",
          checked ? "justify-end border-accent bg-accent" : "justify-start border-line-strong bg-well",
        )}
      >
        <motion.span
          layout
          transition={transition.layout}
          className={cn("size-3 rounded-xs", checked ? "bg-on-accent" : "bg-fg-muted")}
        />
      </button>
    </div>
  );
}
