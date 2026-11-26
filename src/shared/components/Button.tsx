import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

// Feedback is colour only (no lift, no scale): precise, never bouncy.
const base =
  "relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium " +
  "transition-[background-color,border-color,color] duration-120 ease-out " +
  "focus-visible:outline-offset-2 disabled:pointer-events-none";

const variants: Record<ButtonVariant, string> = {
  // The one solid bronze control on a screen.
  primary:
    "border border-accent bg-accent text-on-accent hover:border-accent-2 hover:bg-accent-2 active:border-copper active:bg-copper " +
    "disabled:border-line disabled:bg-elevated disabled:text-fg-disabled",
  secondary:
    "border border-line-strong bg-elevated text-fg hover:border-fg-disabled hover:bg-elevated-2 active:bg-elevated " +
    "disabled:border-line disabled:bg-transparent disabled:text-fg-disabled",
  ghost: "border border-transparent text-fg-muted hover:bg-glass-strong hover:text-fg active:bg-glass disabled:text-fg-disabled",
  danger: "border border-danger/35 text-danger hover:border-danger/55 hover:bg-danger-soft disabled:opacity-40",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconRight, loading, disabled, className, children, type = "button", ...rest },
  ref,
) {
  const iconSize = size === "sm" ? 14 : 16;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? <Spinner size={iconSize} /> : icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Required: icon-only buttons must have an accessible name. */
  label: string;
  size?: ButtonSize;
  variant?: Exclude<ButtonVariant, "primary">;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = "md", variant = "ghost", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(base, variants[variant], size === "sm" ? "size-7" : "size-8", className)}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 14 : 16} />
    </button>
  );
});
