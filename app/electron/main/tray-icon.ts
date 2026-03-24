import { nativeImage } from "electron";

const traySvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <rect x="1" y="1" width="14" height="14" rx="4" fill="#111417"/>
  <rect x="2" y="2" width="12" height="12" rx="3" fill="#171B1F" stroke="#2A3238"/>
  <path d="M4 10.5h1.9l1.3-4 1.6 5 1.2-3H12" fill="none" stroke="#34D1BF" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`.trim();

export function createTrayIcon() {
  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(traySvg).toString("base64")}`,
  );

  return image.resize({ width: 16, height: 16 });
}
