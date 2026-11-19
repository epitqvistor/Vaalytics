/** Small presentational pieces for the Location Atlas. */
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/shared/components";
import type { Confidence } from "./data/types";

const CONFIDENCE: Record<Confidence, { tone: BadgeTone; label: string; help: string }> = {
  verified: { tone: "success", label: "Verified", help: "From the game files or your own Client.txt." },
  community: { tone: "info", label: "Community", help: "From a licensed community source; usually right, not guaranteed." },
  partial: { tone: "warning", label: "Partly verified", help: "Some of this is verified, some isn't." },
  estimated: { tone: "warning", label: "Estimated", help: "Derived, not observed." },
  unverified: { tone: "neutral", label: "Unverified", help: "No source confirms this." },
  outdated: { tone: "danger", label: "Outdated", help: "Was right for an older patch." },
};

/** Confidence is always shown with words, never colour alone. */
export function ConfidenceBadge({ confidence, label }: { confidence: Confidence; label?: string }) {
  const c = CONFIDENCE[confidence];
  return (
    <span title={c.help}>
      <Badge tone={c.tone}>{label ?? c.label}</Badge>
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{children}</p>;
}
