import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";

import { IPC_CHANNELS } from "../dist-electron/src/domain/ipc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.resolve(__dirname, "../dist-electron/electron/preload/index.cjs");

const initialSnapshot = {
  providers: [],
  refreshedAt: "2026-03-25T00:00:00.000Z",
  selectedUsageRange: "week",
};

const refreshedSnapshot = {
  providers: [],
  refreshedAt: "2026-03-25T00:05:00.000Z",
  selectedUsageRange: "today",
};

async function main() {
  await app.whenReady();

  ipcMain.handle(IPC_CHANNELS.getDashboard, () => initialSnapshot);
  ipcMain.handle(IPC_CHANNELS.refreshDashboard, () => refreshedSnapshot);
  ipcMain.handle(IPC_CHANNELS.setDashboardUsageRange, (_event, range) => ({
    providers: [],
    refreshedAt: "2026-03-25T00:06:00.000Z",
    selectedUsageRange: range,
  }));

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await window.loadURL("data:text/html,<html><body>sandbox-test</body></html>");
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        const bridge = window.pulsedock;
        if (!bridge) {
          throw new Error("PulseDock bridge missing in sandboxed renderer");
        }

        return {
          keys: Object.keys(bridge).sort(),
          initial: await bridge.getDashboard(),
          refreshed: await bridge.refreshDashboard(),
          ranged: await bridge.setDashboardUsageRange("month"),
        };
      })();
    `);

    process.stdout.write(`${JSON.stringify(result)}\n`);
    ipcMain.removeHandler(IPC_CHANNELS.getDashboard);
    ipcMain.removeHandler(IPC_CHANNELS.refreshDashboard);
    ipcMain.removeHandler(IPC_CHANNELS.setDashboardUsageRange);
    window.destroy();
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    ipcMain.removeHandler(IPC_CHANNELS.getDashboard);
    ipcMain.removeHandler(IPC_CHANNELS.refreshDashboard);
    ipcMain.removeHandler(IPC_CHANNELS.setDashboardUsageRange);
    window.destroy();
    app.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  app.exit(1);
});
