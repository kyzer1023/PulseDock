import { app, Menu, Tray } from "electron";
import { ProviderCollector } from "../../src/application/provider-collector.js";
import { ProviderOrchestrator } from "../../src/application/provider-orchestrator.js";
import { providers } from "../../src/providers/index.js";
import { createTrayIcon } from "./tray-icon.js";
import { registerDashboardIpc } from "./ipc.js";
import { runBridgeSmokeTest } from "./smoke-test.js";
import { createPopupWindow, togglePopupWindow } from "./window.js";

let tray: Tray | null = null;
const smokeTestOutputPath = process.env.PULSEDOCK_SMOKE_TEST_OUTPUT?.trim() || null;

async function bootstrap(): Promise<void> {
  const collector = new ProviderCollector(
    new URL("../../src/application/provider-collector-worker.js", import.meta.url),
  );
  const orchestrator = new ProviderOrchestrator(providers, collector);
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
    collector.dispose();
  });

  await orchestrator.refresh();
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.kyzer.pulsedock");

  if (smokeTestOutputPath) {
    void runBridgeSmokeTest(smokeTestOutputPath);
    return;
  }

  app.on("activate", () => {
    if (tray?.isDestroyed()) {
      void bootstrap();
    }
  });

  void bootstrap();
});
