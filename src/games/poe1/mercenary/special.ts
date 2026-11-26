import { lazy } from "react";
import type { SpecialItemView } from "@/shared/views/price-check/special";
import { looksLikeWarrant } from "./parse";

/** The Price Checker (overlay and paste) shows the Mercenary Intelligence check for Mercenary Warrants. */
export const MERCENARY_CHECK: SpecialItemView = {
  match: (item) => item.game === "poe1" && item.baseType === "Mercenary Warrant" && looksLikeWarrant(item.raw),
  Component: lazy(() => import("./MercenaryCheck").then((m) => ({ default: m.MercenaryCheck }))),
};
