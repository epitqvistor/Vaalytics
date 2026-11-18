/** Rust `campaign_events` rows → engine events. */
import type { CampaignEventRow } from "@/core/ipc/commands";
import type { CampaignEvent } from "./progress";

export type { CampaignEventRow };

export function toEngineEvents(rows: readonly CampaignEventRow[]): CampaignEvent[] {
  const out: CampaignEvent[] = [];
  for (const r of rows) {
    switch (r.kind) {
      case "zone":
        if (r.areaId) out.push({ kind: "zone", at: r.at, areaId: r.areaId, name: r.areaName, level: r.areaLevel });
        break;
      case "passive_points":
      case "weapon_set_points":
        out.push({ kind: "passive-points", at: r.at, amount: r.amount ?? 0, weaponSet: r.kind === "weapon_set_points" });
        break;
      case "level":
        if (r.amount != null) out.push({ kind: "level", at: r.at, level: r.amount });
        break;
      case "ascended": {
        const [fromClass = "", toClass = ""] = (r.detail ?? "").split("→");
        out.push({ kind: "ascended", at: r.at, fromClass, toClass });
        break;
      }
      case "death":
        out.push({ kind: "death", at: r.at });
        break;
    }
  }
  return out;
}
