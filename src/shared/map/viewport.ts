/** Pan/zoom math for schematic maps (pure). A view maps content units to screen pixels: screen = content × k + (x, y). */

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
const clampK = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Zoom by `factor` keeping the screen point `at` fixed (mouse-wheel zoom). */
export function zoomAt(v: View, factor: number, at: { x: number; y: number }): View {
  const k = clampK(v.k * factor);
  const f = k / v.k;
  return { k, x: at.x - (at.x - v.x) * f, y: at.y - (at.y - v.y) * f };
}

export const panBy = (v: View, dx: number, dy: number): View => ({ ...v, x: v.x + dx, y: v.y + dy });

/** The view that fits `content` into a `width × height` viewport with `padding` pixels around it. */
export function fitView(content: Box, width: number, height: number, padding = 24): View {
  if (content.width <= 0 || content.height <= 0 || width <= 0 || height <= 0) return { x: 0, y: 0, k: 1 };
  const k = clampK(Math.min((width - 2 * padding) / content.width, (height - 2 * padding) / content.height, 1.5));
  return { k, x: (width - content.width * k) / 2 - content.x * k, y: (height - content.height * k) / 2 - content.y * k };
}

/** Screen point → content point. */
export const toContent = (v: View, p: { x: number; y: number }) => ({ x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k });
