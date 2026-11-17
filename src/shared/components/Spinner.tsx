import { cn } from "@/shared/utilities/cn";

/** CSS-only spinner (transform rotation). Only mounted while something is loading. */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={cn("shrink-0 animate-spin", className)}
      aria-hidden
      fill="none"
    >
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
      <path d="M17.25 10A7.25 7.25 0 0 0 10 2.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
