/**
 * Motion standards. Every animation in Vaalytics uses these presets so timing
 * feels consistent. Rules:
 *  - transform + opacity only (no width/height/top/left animation)
 *  - 120–260 ms; nothing loops or runs permanently
 *  - reduced motion is honoured globally via <MotionConfig reducedMotion="user">
 */
import type { Transition, Variants } from "motion/react";

export const duration = {
  instant: 0.12, // hover/press feedback
  fast: 0.16, // small elements: tooltips, menus
  base: 0.22, // panels, page transitions
  slow: 0.26, // large surfaces: modals, overlay expand
} as const;

export const ease = {
  /** Default for entering elements: quick start, soft landing. */
  out: [0.22, 1, 0.36, 1],
  /** For exits: accelerate away. */
  in: [0.4, 0, 1, 1],
  standard: [0.4, 0, 0.2, 1],
} as const satisfies Record<string, [number, number, number, number]>;

export const transition = {
  base: { duration: duration.base, ease: ease.out },
  fast: { duration: duration.fast, ease: ease.out },
  exit: { duration: duration.fast, ease: ease.in },
  /** Shared-layout indicators (active nav pill, segmented control thumb). */
  layout: { type: "spring", stiffness: 520, damping: 42, mass: 0.9 },
} as const satisfies Record<string, Transition>;

export const variants = {
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: transition.base },
    exit: { opacity: 0, transition: transition.exit },
  },
  /** Content panes / page sections. */
  rise: {
    hidden: { opacity: 0, y: 6 },
    visible: { opacity: 1, y: 0, transition: transition.base },
    exit: { opacity: 0, y: -4, transition: transition.exit },
  },
  /** Modals, popovers. */
  pop: {
    hidden: { opacity: 0, scale: 0.97, y: 4 },
    visible: { opacity: 1, scale: 1, y: 0, transition: { duration: duration.slow, ease: ease.out } },
    exit: { opacity: 0, scale: 0.98, transition: transition.exit },
  },
} as const satisfies Record<string, Variants>;

/** Container that reveals its children (each using `variants.rise`) one after another. */
export const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
} as const satisfies Variants;
