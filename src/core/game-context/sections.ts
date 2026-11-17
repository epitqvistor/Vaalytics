/**
 * Section = module of a game environment. The registry (navigation, groups,
 * per-game status) lives in src/core/modules/registry.ts.
 */
import type { ModuleId } from "@/core/modules/registry";

export type SectionId = ModuleId;

export interface SectionProps {
  onNavigate: (section: SectionId) => void;
}
