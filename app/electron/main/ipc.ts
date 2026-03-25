import { app, BrowserWindow, ipcMain, shell } from "electron";
import { ProviderOrchestrator } from "../../src/application/provider-orchestrator.js";
import { IPC_CHANNELS } from "../../src/domain/ipc.js";
import type { DashboardSnapshot } from "../../src/domain/dashboard.js";
import { assertAllowedExternalUrl } from "../../src/domain/external-url.js";

type DashboardListener = (snapshot: DashboardSnapshot) => void;

export function registerDashboardIpc(
  orchestrator: ProviderOrchestrator,
  window: BrowserWindow,
): () => void {
  const onChanged: DashboardListener = (snapshot) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.dashboardChanged, snapshot);
    }
  };

  orchestrator.on("changed", onChanged);

  ipcMain.handle(IPC_CHANNELS.getDashboard, () => orchestrator.getSnapshot());
  ipcMain.handle(IPC_CHANNELS.openExternal, (_event, url: string) =>
    shell.openExternal(assertAllowedExternalUrl(url)),
  );
  ipcMain.handle(IPC_CHANNELS.quitApp, () => app.quit());
  ipcMain.handle(IPC_CHANNELS.refreshDashboard, () => orchestrator.refresh());

  return () => {
    orchestrator.off("changed", onChanged);
    ipcMain.removeHandler(IPC_CHANNELS.getDashboard);
    ipcMain.removeHandler(IPC_CHANNELS.openExternal);
    ipcMain.removeHandler(IPC_CHANNELS.quitApp);
    ipcMain.removeHandler(IPC_CHANNELS.refreshDashboard);
  };
}

export function registerStaticDashboardIpc(snapshot: DashboardSnapshot): () => void {
  ipcMain.handle(IPC_CHANNELS.getDashboard, () => snapshot);
  ipcMain.handle(IPC_CHANNELS.openExternal, (_event, url: string) =>
    shell.openExternal(assertAllowedExternalUrl(url)),
  );
  ipcMain.handle(IPC_CHANNELS.quitApp, () => app.quit());
  ipcMain.handle(IPC_CHANNELS.refreshDashboard, () => snapshot);

  return () => {
    ipcMain.removeHandler(IPC_CHANNELS.getDashboard);
    ipcMain.removeHandler(IPC_CHANNELS.openExternal);
    ipcMain.removeHandler(IPC_CHANNELS.quitApp);
    ipcMain.removeHandler(IPC_CHANNELS.refreshDashboard);
  };
}
