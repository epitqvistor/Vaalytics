import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import "@/styles/index.css";

// The price-check overlay is a separate window loading the same bundle with #overlay.
const OverlayApp = lazy(() => import("@/app/overlay/OverlayApp"));
const isOverlay = window.location.hash === "#overlay";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isOverlay ? (
      <Suspense fallback={null}>
        <OverlayApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
