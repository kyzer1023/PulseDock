import { app, Menu, Tray } from "electron";
import { ProviderOrchestrator } from "../../src/application/provider-orchestrator.js";
import { providers } from "../../src/providers/index.js";
import { createTrayIcon } from "./tray-icon.js";
import { registerDashboardIpc } from "./ipc.js";
import { createPopupWindow, togglePopupWindow } from "./window.js";

let tray: Tray | null = null;

async function bootstrap(): Promise<void> {
  const orchestrator = new ProviderOrchestrator(providers);
  const window = createPopupWindow();
  const unregisterIpc = registerDashboardIpc(orchestrator, window);

  tray = new Tray(createTrayIcon());
  tray.setToolTip("PulseDock");
  tray.addListener("click", () => {
    if (tray) {
      togglePopupWindow(window, tray);
    }
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Refresh",
        click: () => {
          void orchestrator.refresh();
        },
      },
      {
        type: "separator",
      },
      {
        label: "Quit PulseDock",
        click: () => {
          app.quit();
        },
      },
    ]),
  );

  window.on("closed", () => {
    unregisterIpc();
  });

  await orchestrator.refresh();
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.kyzer.pulsedock");
  app.on("activate", () => {
    if (tray?.isDestroyed()) {
      void bootstrap();
    }
  });

  void bootstrap();
});
