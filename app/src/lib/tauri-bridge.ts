import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DashboardSnapshot, PulseDockApi } from "@domain/dashboard";
import type { UsageRangePresetId } from "@domain/usage-range";

const DASHBOARD_CHANGED_EVENT = "pulsedock:dashboard-changed";

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function createPulseDockApi(): PulseDockApi {
  return {
    getDashboard() {
      return invoke<DashboardSnapshot>("get_dashboard");
    },
    openExternal(url) {
      return invoke("open_external", { url });
    },
    quitApp() {
      return invoke("quit_app");
    },
    refreshDashboard() {
      return invoke<DashboardSnapshot>("refresh_dashboard");
    },
    setDashboardUsageRange(range) {
      return invoke<DashboardSnapshot>("set_dashboard_usage_range", { range });
    },
    onDashboardChanged(listener) {
      const unlisten = listen<DashboardSnapshot>(DASHBOARD_CHANGED_EVENT, (event) => {
        listener(event.payload);
      });

      return () => {
        void unlisten.then((dispose) => dispose());
      };
    },
  };
}

export function installTauriBridge(): PulseDockApi | null {
  if (window.pulsedock) {
    return window.pulsedock;
  }

  if (!hasTauriRuntime()) {
    return null;
  }

  const api = createPulseDockApi();
  window.pulsedock = api;
  return api;
}

async function waitForDashboardRender(): Promise<string> {
  const deadline = Date.now() + 5_000;
  let bodyText = document.body.textContent || "";

  while (
    !document.querySelector('[aria-label="Refresh usage data"]') &&
    !bodyText.includes("Refresh")
  ) {
    if (Date.now() > deadline) {
      throw new Error("Tauri renderer did not finish rendering the dashboard UI");
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    bodyText = document.body.textContent || "";
  }

  return bodyText;
}

export async function maybeRunSmokeProbe(): Promise<void> {
  if (!hasTauriRuntime()) {
    return;
  }

  const smokeMode = await invoke<boolean>("is_smoke_mode");
  if (!smokeMode) {
    return;
  }

  const bridge = installTauriBridge();
  if (!bridge) {
    throw new Error("PulseDock bridge missing in smoke mode.");
  }
  const bodyText = await waitForDashboardRender();

  await invoke("write_smoke_result", {
    payload: {
      keys: Object.keys(bridge).sort(),
      bodyText,
      initial: await bridge.getDashboard(),
      refreshed: await bridge.refreshDashboard(),
    },
  });
}

export function hideWindowOnBlur(): void {
  if (!hasTauriRuntime()) {
    return;
  }

  window.addEventListener("blur", () => {
    void invoke("hide_main_window").catch(() => undefined);
  });
}
