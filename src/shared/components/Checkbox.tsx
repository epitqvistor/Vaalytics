import { useId, type ReactNode } from "react";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, onChange, label, disabled, className }: CheckboxProps) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("group flex min-w-0 items-center gap-2.5", disabled ? "opacity-50" : "cursor-default", className)}>
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 appearance-none rounded-xs border border-line-strong bg-elevated transition-colors checked:border-accent checked:bg-accent group-hover:border-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <Icon name="check" size={12} className="pointer-events-none relative text-on-accent opacity-0 peer-checked:opacity-100" />
      </span>
      <span className="min-w-0 flex-1">{label}</span>
    </label>
  );
}
