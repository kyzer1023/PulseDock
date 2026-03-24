import path from "node:path";
import { app, nativeImage } from "electron";

function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets", "icon.png");
  }

  return path.join(app.getAppPath(), "app", "src", "assets", "icon.png");
}

export function createTrayIcon() {
  const iconPath = getIconPath();
  const image = nativeImage.createFromPath(iconPath);

  if (image.isEmpty()) {
    return nativeImage.createEmpty();
  }

  return image.resize({ width: 16, height: 16 });
}
