import { describeProvenance, KIND_LABEL, type DataKind, type Provenance } from "@/core/provenance";
import { Badge, type BadgeTone } from "./Badge";

const TONE: Record<DataKind, BadgeTone> = { market: "success", historical: "info", estimate: "accent", user: "neutral", "game-data": "neutral" };

/** Small tag that says what kind of data a value is; the tooltip adds source and time. */
export function ProvenanceTag({ provenance, className }: { provenance: Provenance; className?: string }) {
  const extra = [provenance.league && `League: ${provenance.league}`, provenance.patch && `Patch ${provenance.patch}`, provenance.note].filter(Boolean).join("\n");
  return (
    <span title={describeProvenance(provenance) + (extra ? `\n${extra}` : "")} className={className}>
      <Badge tone={TONE[provenance.kind]} dot={provenance.kind === "market"}>
        {KIND_LABEL[provenance.kind]}
      </Badge>
    </span>
  );
}
