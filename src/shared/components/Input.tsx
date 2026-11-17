import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: IconName;
  /** Trailing content, e.g. a unit ("chaos") or a <Kbd>. */
  suffix?: ReactNode;
  size?: "sm" | "md";
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, suffix, size = "md", className, containerClassName, id, disabled, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-fg-muted">
          {label}
        </label>
      )}
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md border bg-elevated px-2.5 transition-colors duration-150",
          "focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--color-accent-soft)]",
          error ? "border-danger/60" : "border-line hover:border-line-strong",
          size === "sm" ? "h-7" : "h-8.5",
          disabled && "opacity-50",
        )}
      >
        {icon && <Icon name={icon} size={14} className="text-fg-subtle group-focus-within:text-fg-muted" />}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-fg placeholder:text-fg-subtle focus-visible:outline-none",
            size === "sm" ? "text-xs" : "text-sm",
            className,
          )}
          {...rest}
        />
        {suffix && <span className="shrink-0 text-xs text-fg-subtle">{suffix}</span>}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
