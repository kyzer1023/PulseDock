import type { PulseDockApi } from "@domain/dashboard";

declare module "*.png" {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    pulsedock: PulseDockApi;
  }
}

export {};
