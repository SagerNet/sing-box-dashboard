import "@fontsource-variable/schibsted-grotesk/index.css";
import "@fontsource-variable/source-serif-4/index.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/globals.css";
import "./styles/shared.css";

// iOS Safari ignores user-scalable=no and touch-action for pinch-zoom;
// cancelling WebKit's non-standard gesture events is the only way to disable it.
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("gesturechange", (e) => e.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
