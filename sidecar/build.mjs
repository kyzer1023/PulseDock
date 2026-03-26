import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const sidecarRoot = __dirname;
const distDir = path.join(sidecarRoot, "dist");
const bundlePath = path.join(distDir, "collector.cjs");
const binariesDir = path.join(projectRoot, "src-tauri", "binaries");

function resolveTargetTriples() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(`Unsupported sidecar build target ${process.platform}/${process.arch}.`);
  }

  return [
    "x86_64-pc-windows-msvc",
    "x86_64-pc-windows-gnullvm",
  ];
}

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
mkdirSync(binariesDir, { recursive: true });

await build({
  entryPoints: [path.join(sidecarRoot, "collector.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  charset: "utf8",
});

run("npx", [
  "pkg",
  bundlePath,
  "--targets",
  "node22-win-x64",
  "--compress",
  "Brotli",
  "--output",
  path.join(distDir, "pulsedock-collector"),
]);

const sourcePath = path.join(distDir, "pulsedock-collector.exe");

for (const targetTriple of resolveTargetTriples()) {
  const targetPath = path.join(
    binariesDir,
    `pulsedock-collector-${targetTriple}.exe`,
  );

  rmSync(targetPath, { force: true });
  copyFileSync(sourcePath, targetPath);
}
