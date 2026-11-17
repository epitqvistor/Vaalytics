import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  children?: ReactNode;
}

// Interactions use transform/box-shadow only (GPU-friendly, no layout shift).
const base =
  "relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium " +
  "transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out " +
  "hover:-translate-y-px active:translate-y-0 active:scale-[0.98] " +
  "focus-visible:outline-offset-2 disabled:pointer-events-none";

const variants: Record<ButtonVariant, string> = {
  // Solid accent with a lit top edge; restrained shadow on hover (no neon glow).
  primary:
    "bg-[linear-gradient(180deg,#f7a058,#ec8330)] text-on-accent " +
    "shadow-[inset_0_1px_0_rgb(255_255_255/0.3),inset_0_-1px_0_rgb(0_0_0/0.15),0_1px_2px_rgb(0_0_0/0.4),0_0_0_1px_rgb(180_90_30/0.6)] " +
    "hover:bg-[linear-gradient(180deg,#ffad66,#f28c38)] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.35),inset_0_-1px_0_rgb(0_0_0/0.15),0_6px_16px_-8px_rgb(242_140_56/0.55),0_0_0_1px_rgb(200_105_40/0.7)] " +
    "disabled:bg-none disabled:bg-elevated disabled:text-fg-disabled disabled:shadow-[inset_0_0_0_1px_var(--color-line)]",
  secondary:
    "border border-line-strong bg-elevated/85 text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] " +
    "hover:border-white/20 hover:bg-elevated-2 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.07),0_4px_12px_-6px_rgb(0_0_0/0.6)] " +
    "disabled:border-line disabled:bg-elevated/50 disabled:text-fg-disabled disabled:shadow-none",
  ghost: "text-fg-muted hover:bg-white/[0.05] hover:text-fg hover:translate-y-0 disabled:text-fg-disabled",
  danger: "border border-danger/30 bg-danger-soft text-danger hover:border-danger/50 hover:bg-danger/20 disabled:opacity-40",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8.5 px-3.5 text-sm",
};

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
      className={cn(base, variants[variant], size === "sm" ? "size-7" : "size-8.5", className)}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 14 : 16} />
    </button>
  );
});
