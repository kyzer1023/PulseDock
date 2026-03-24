import type { PulseDockApi } from "@domain/dashboard";

declare global {
  interface Window {
    pulsedock: PulseDockApi;
  }
}

export {};
