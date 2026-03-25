import { useEffect, useState } from "react";
import type { DashboardSnapshot } from "@domain/dashboard";

const BRIDGE_ERROR_MESSAGE = "PulseDock desktop bridge failed to load. Restart the app.";

export function useDashboard() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  function getBridge() {
    const bridge = window.pulsedock;
    if (!bridge) {
      setBridgeError(BRIDGE_ERROR_MESSAGE);
      return null;
    }

    return bridge;
  }

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      return;
    }

    let active = true;

    const unsubscribe = bridge.onDashboardChanged((nextSnapshot) => {
      if (!active) {
        return;
      }

      setSnapshot(nextSnapshot);
      setBridgeError(null);
    });

    void bridge
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
    const bridge = getBridge();
    if (!bridge) {
      return;
    }

    try {
      const nextSnapshot = await bridge.refreshDashboard();
      setSnapshot(nextSnapshot);
      setBridgeError(null);
    } catch (error: unknown) {
      setBridgeError(error instanceof Error ? error.message : String(error));
    }
  }

  async function openExternal(url: string): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      return;
    }

    await bridge.openExternal(url);
  }

  async function quitApp(): Promise<void> {
    const bridge = getBridge();
    if (!bridge) {
      return;
    }

    await bridge.quitApp();
  }

  return {
    bridgeError,
    openExternal,
    quitApp,
    refresh,
    snapshot,
  };
}
