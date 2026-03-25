import { contextBridge, ipcRenderer } from "electron";
import type { PulseDockApi } from "../../src/domain/dashboard.js";
import { IPC_CHANNELS } from "../../src/domain/ipc.js";

const api: PulseDockApi = {
  getDashboard() {
    return ipcRenderer.invoke(IPC_CHANNELS.getDashboard);
  },
  openExternal(url) {
    return ipcRenderer.invoke(IPC_CHANNELS.openExternal, url);
  },
  quitApp() {
    return ipcRenderer.invoke(IPC_CHANNELS.quitApp);
  },
  refreshDashboard() {
    return ipcRenderer.invoke(IPC_CHANNELS.refreshDashboard);
  },
  setDashboardUsageRange(range) {
    return ipcRenderer.invoke(IPC_CHANNELS.setDashboardUsageRange, range);
  },
  onDashboardChanged(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, snapshot: Parameters<typeof listener>[0]) => {
      listener(snapshot);
    };

    ipcRenderer.on(IPC_CHANNELS.dashboardChanged, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.dashboardChanged, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("pulsedock", api);
