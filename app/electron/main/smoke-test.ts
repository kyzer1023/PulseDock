import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, type Event } from "electron";
import type { DashboardSnapshot } from "../../src/domain/dashboard.js";
import { DEFAULT_USAGE_RANGE_PRESET_ID } from "../../src/domain/usage-range.js";
import { registerStaticDashboardIpc } from "./ipc.js";
import { createPopupWindow } from "./window.js";

const SMOKE_SNAPSHOT: DashboardSnapshot = {
  summary: {
    estimatedCost: 0,
    totalTokens: 0,
    providerCount: 0,
    loadedProviderCount: 0,
    usageWindow: {
      label: "Last 7 days",
      since: "2026-03-19T00:00:00.000Z",
      until: "2026-03-25T00:00:00.000Z",
    },
  },
  providers: [],
  notices: [],
  lastRefreshedAt: "2026-03-25T00:00:00.000Z",
  provenance: ["Packaged smoke test"],
  loadingState: "idle",
  selectedUsageRange: DEFAULT_USAGE_RANGE_PRESET_ID,
};

async function waitForRenderer(window: BrowserWindow): Promise<void> {
  if (!window.webContents.isLoadingMainFrame()) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.webContents.removeListener("did-finish-load", handleLoad);
      window.webContents.removeListener("did-fail-load", handleFail);
    };

    const handleLoad = () => {
      cleanup();
      resolve();
    };

    const handleFail = (_event: Event, code: number, description: string) => {
      cleanup();
      reject(new Error(`Renderer failed to load (${code}): ${description}`));
    };

    window.webContents.once("did-finish-load", handleLoad);
    window.webContents.once("did-fail-load", handleFail);
  });
}

async function writeResult(outputPath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
}

export async function runBridgeSmokeTest(outputPath: string): Promise<void> {
  const unregisterIpc = registerStaticDashboardIpc(SMOKE_SNAPSHOT);
  const window = createPopupWindow();

  try {
    await waitForRenderer(window);

    const result = await window.webContents.executeJavaScript(`
      (async () => {
        const bridge = window.pulsedock;
        if (!bridge) {
          throw new Error("PulseDock bridge missing in packaged app");
        }

        const deadline = Date.now() + 5000;
        let bodyText = document.body.textContent || "";

        while (
          !document.querySelector('[aria-label="Refresh usage data"]') &&
          !bodyText.includes("Refresh")
        ) {
          if (Date.now() > deadline) {
            throw new Error("Packaged renderer did not finish rendering the dashboard UI");
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
          bodyText = document.body.textContent || "";
        }

        return {
          keys: Object.keys(bridge).sort(),
          bodyText,
          initial: await bridge.getDashboard(),
          refreshed: await bridge.refreshDashboard(),
        };
      })();
    `);

    await writeResult(outputPath, result);
    unregisterIpc();
    window.destroy();
    app.exit(0);
  } catch (error) {
    await writeResult(outputPath, {
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
    unregisterIpc();
    window.destroy();
    app.exit(1);
  }
}
