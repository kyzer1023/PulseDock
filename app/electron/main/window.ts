import { fileURLToPath } from "node:url";
import { BrowserWindow, screen, Tray } from "electron";

const POPUP_WIDTH = 388;
const POPUP_HEIGHT = 520;
const WINDOW_MARGIN = 10;

function getRendererUrl(): string {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    return devServerUrl;
  }

  return new URL("../../../dist/renderer/index.html", import.meta.url).toString();
}

export function createPopupWindow(): BrowserWindow {
  const preloadPath = fileURLToPath(new URL("../preload/index.js", import.meta.url));

  const window = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: "#111417",
    vibrancy: "under-window",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.on("blur", () => {
    if (!window.webContents.isDevToolsOpened()) {
      window.hide();
    }
  });

  const rendererUrl = getRendererUrl();
  if (rendererUrl.startsWith("http")) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(fileURLToPath(rendererUrl));
  }

  return window;
}

export function togglePopupWindow(window: BrowserWindow, tray: Tray): void {
  if (window.isVisible()) {
    window.hide();
    return;
  }

  positionPopupWindow(window, tray);
  window.show();
  window.focus();
}

function positionPopupWindow(window: BrowserWindow, tray: Tray): void {
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x + Math.round(trayBounds.width / 2),
    y: trayBounds.y + Math.round(trayBounds.height / 2),
  });
  const workArea = display.workArea;
  const { width: windowWidth, height: windowHeight } = window.getBounds();

  const targetX = trayBounds.x + Math.round(trayBounds.width / 2) - Math.round(windowWidth / 2);
  const clampedX = Math.min(
    Math.max(targetX, workArea.x + WINDOW_MARGIN),
    workArea.x + workArea.width - windowWidth - WINDOW_MARGIN,
  );

  const belowY = trayBounds.y + trayBounds.height + WINDOW_MARGIN;
  const aboveY = trayBounds.y - windowHeight - WINDOW_MARGIN;
  const targetY =
    belowY + windowHeight <= workArea.y + workArea.height
      ? belowY
      : Math.max(workArea.y + WINDOW_MARGIN, aboveY);

  window.setPosition(clampedX, targetY, false);
}
