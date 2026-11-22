import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import "@/styles/index.css";

// The price-check overlay is a separate window loading the same bundle with #overlay.
const OverlayApp = lazy(() => import("@/app/overlay/OverlayApp"));
const isOverlay = window.location.hash === "#overlay";
// The Location Atlas (PoE 1) is another window of the same bundle at #atlas.
const AtlasWindow = lazy(() => import("@/games/poe1/location-atlas/AtlasWindow"));
const isAtlas = window.location.hash.startsWith("#atlas");
// The Act Tracker (PoE 1) overlay is another window of the same bundle at #act-tracker.
const TrackerWindow = lazy(() => import("@/games/poe1/act-tracker/TrackerWindow"));
const isTracker = window.location.hash === "#act-tracker";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isTracker ? (
      <Suspense fallback={null}>
        <TrackerWindow />
      </Suspense>
    ) : isAtlas ? (
      <Suspense fallback={null}>
        <AtlasWindow />
      </Suspense>
    ) : isOverlay ? (
      <Suspense fallback={null}>
        <OverlayApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
