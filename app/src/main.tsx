import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@renderer/App";
import {
  hideWindowOnBlur,
  installTauriBridge,
  maybeRunSmokeProbe,
} from "@renderer/lib/tauri-bridge";
import "@styles/global.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("PulseDock root container was not found.");
}

installTauriBridge();
hideWindowOnBlur();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void maybeRunSmokeProbe();
