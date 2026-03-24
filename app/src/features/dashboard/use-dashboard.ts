import { useEffect, useState } from "react";
import type { DashboardSnapshot } from "@domain/dashboard";

export function useDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const unsubscribe = window.pulsedock.onDashboardChanged((nextSnapshot) => {
      if (!active) {
        return;
      }

      setSnapshot(nextSnapshot);
      setBridgeError(null);
    });

    void window.pulsedock
      .getDashboard()
      .then((nextSnapshot) => {
        if (!active) {
          return;
        }

        setSnapshot(nextSnapshot);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setBridgeError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function refresh(): Promise<void> {
    const nextSnapshot = await window.pulsedock.refreshDashboard();
    setSnapshot(nextSnapshot);
  }

  async function openExternal(url: string): Promise<void> {
    await window.pulsedock.openExternal(url);
  }

  async function quitApp(): Promise<void> {
    await window.pulsedock.quitApp();
  }

  return {
    bridgeError,
    openExternal,
    quitApp,
    refresh,
    snapshot,
  };
}
