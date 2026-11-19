/**
 * Pan/zoom container for schematic SVG maps (game-agnostic). Wheel zooms around
 * the cursor, drag pans (a click under 4 px still reaches the markers), +/−/0
 * keys and buttons zoom / fit. It fits the content on first show and whenever
 * `fitKey` changes, and refits on resize until the user moves the map.
 * Only one <g transform> changes while panning — the geometry never re-renders.
 */
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/shared/components";
import { cn } from "@/shared/utilities/cn";
import { fitView, panBy, zoomAt, type Box, type View } from "./viewport";

const DRAG_THRESHOLD = 4;

export function MapViewport({
  content,
  fitKey,
  children,
  overlay,
  className,
  label,
}: {
  /** Bounds of the drawn content, in content units. */
  content: Box;
  /** Refit when this changes (e.g. another act). */
  fitKey: string;
  children: ReactNode;
  /** Absolutely positioned UI over the map (legend, layer toggles). */
  overlay?: ReactNode;
  className?: string;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [animate, setAnimate] = useState(false);
  const touched = useRef(false);
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const reduce = useReducedMotion();

  const fit = useCallback(
    (smooth: boolean) => {
      const el = host.current;
      if (!el) return;
      setAnimate(smooth && !reduce);
      setView(fitView(content, el.clientWidth, el.clientHeight, 32));
    },
    [content, reduce],
  );

  useLayoutEffect(() => {
    touched.current = false;
    fit(false);
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => !touched.current && fit(false));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Wheel must be non-passive to stop the page from scrolling.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      touched.current = true;
      setAnimate(false);
      setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomCentre = (factor: number) => {
    const el = host.current;
    if (!el) return;
    touched.current = true;
    setAnimate(!reduce);
    setView((v) => zoomAt(v, factor, { x: el.clientWidth / 2, y: el.clientHeight / 2 }));
  };

  return (
    <div
      ref={host}
      role="application"
      aria-label={label}
      tabIndex={0}
      className={cn("relative h-full w-full touch-none overflow-hidden outline-none select-none", drag.current?.moved ? "cursor-grabbing" : "cursor-grab", className)}
      onKeyDown={(e) => {
        if (e.key === "+" || e.key === "=") zoomCentre(1.25);
        else if (e.key === "-") zoomCentre(0.8);
        else if (e.key === "0") fit(true);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!d.moved) {
          d.moved = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
        d.x = e.clientX;
        d.y = e.clientY;
        touched.current = true;
        setAnimate(false);
        setView((v) => panBy(v, dx, dy));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          // Swallow the click that ends a drag so markers aren't selected by accident.
          const stop = (ev: MouseEvent) => ev.stopPropagation();
          window.addEventListener("click", stop, { capture: true, once: true });
          window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
        }
      }}
    >
      <svg className="absolute inset-0 h-full w-full" role="img" aria-label={label}>
        <g
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
            transformOrigin: "0 0",
            transition: animate ? "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
          }}
        >
          {children}
        </g>
      </svg>
      {overlay}
      <div className="absolute right-3 bottom-3 flex flex-col gap-1 rounded-md border border-line bg-bg-2/90 p-1">
        <IconButton size="sm" icon="plus" label="Zoom in (+)" onClick={() => zoomCentre(1.25)} />
        <IconButton size="sm" icon="minimize" label="Zoom out (−)" onClick={() => zoomCentre(0.8)} />
        <IconButton size="sm" icon="compact" label="Fit to view (0)" onClick={() => fit(true)} />
      </div>
    </div>
  );
}
