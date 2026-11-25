import { lazy } from "react";
import type { SpecialItemView } from "@/shared/views/price-check/special";
import { parseUltimatum, ULTIMATUM_BASE } from "./parse";

/** The Price Checker (overlay and paste) shows the Ultimatum check for Inscribed Ultimatums. */
export const ULTIMATUM_CHECK: SpecialItemView = {
  match: (item) => item.game === "poe1" && item.baseType === ULTIMATUM_BASE && parseUltimatum(item.raw) !== null,
  Component: lazy(() => import("./UltimatumCard").then((m) => ({ default: m.UltimatumCheck }))),
};
