import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, screen, Tray } from "electron";

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

function getWindowIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets", "icon.png");
  }

  return path.join(app.getAppPath(), "app", "src", "assets", "icon.png");
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
    backgroundColor: "#13161a",
    icon: getWindowIconPath(),
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

function positionPopupWindow(window: BrowserWindow, _tray: Tray): void {
  const cursorPos = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPos);
  const workArea = display.workArea;
  const { width: windowWidth, height: windowHeight } = window.getBounds();

  const x = workArea.x + workArea.width - windowWidth - WINDOW_MARGIN;
  const y = workArea.y + workArea.height - windowHeight - WINDOW_MARGIN;

  window.setPosition(x, y, false);
}
