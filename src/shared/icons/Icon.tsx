import { memo } from "react";
import { cn } from "@/shared/utilities/cn";
import { ICONS, type IconName } from "./icons";

export interface IconProps {
  name: IconName;
  /** Pixel size; defaults to 16 (navigation/buttons). Use 14 in dense rows, 20 for emphasis. */
  size?: number;
  className?: string;
  /** Provide a label only when the icon conveys meaning on its own. */
  label?: string;
}

export const Icon = memo(function Icon({ name, size = 16, className, label }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
});
