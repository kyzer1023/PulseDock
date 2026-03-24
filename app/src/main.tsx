import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@renderer/App";
import "@styles/global.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("PulseDock root container was not found.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
