import type { ReactNode } from "react";
import { Icon } from "@/shared/icons/Icon";
import { Badge } from "./Badge";

/**
 * Mandatory label for any prototype screen rendering sample values. Sample data
 * must never be mistaken for live market data.
 */
export function SampleDataNotice({ children }: { children?: ReactNode }) {
  return (
    <div role="note" className="mb-5 flex items-center gap-3 rounded-md border border-info/25 bg-info-soft px-3.5 py-2.5 text-sm">
      <Icon name="info" size={16} className="text-info" />
      <p className="flex-1 text-fg">
        {children ?? "Prototype screen. All prices, listings and sellers below are sample data — not live market information."}
      </p>
      <Badge tone="info">Sample data</Badge>
    </div>
  );
}
