import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateExePaths = [
  path.join(appRoot, "src-tauri", "target", "release", "pulsedock.exe"),
  path.join(appRoot, "src-tauri", "target", "x86_64-pc-windows-gnullvm", "release", "pulsedock.exe"),
];

async function collectFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }
    return [fullPath];
  }));

  return nested.flat();
}

async function resolvePackagedExe() {
  for (const candidatePath of candidateExePaths) {
    try {
      await fs.access(candidatePath);
      return candidatePath;
    } catch {
      continue;
    }
  }

  throw new Error(`No packaged executable found. Checked: ${candidateExePaths.join(", ")}`);
}

test("packaged app loads the Tauri bridge from the final artifact", {
  skip: process.platform !== "win32",
}, async () => {
  const packagedExe = await resolvePackagedExe();
  const packagedFiles = await collectFiles(path.dirname(packagedExe));
  const sidecars = packagedFiles.filter((filePath) => /pulsedock-collector.*\.exe$/i.test(path.basename(filePath)));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulsedock-packaged-smoke-"));
  const outputPath = path.join(tempDir, "bridge-result.json");

  assert.deepEqual(sidecars, []);

  const child = spawn(packagedExe, [], {
    cwd: appRoot,
    env: {
      ...process.env,
      PULSEDOCK_SMOKE_TEST_OUTPUT: outputPath,
    },
    stdio: "ignore",
    windowsHide: true,
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });

  assert.equal(exitCode, 0);

  const payload = JSON.parse(await fs.readFile(outputPath, "utf8"));
  assert.deepEqual(payload.keys, [
    "getDashboard",
    "onDashboardChanged",
    "openExternal",
    "quitApp",
    "refreshDashboard",
    "setDashboardUsageRange",
  ]);
  assert.match(payload.bodyText, /Refresh/);
  assert.deepEqual(payload.initial.summary, {
    estimatedCost: 0,
    totalTokens: 0,
    providerCount: 0,
    loadedProviderCount: 0,
    usageWindow: {
      label: "Last 7 days",
      since: "2026-03-19T00:00:00.000Z",
      until: "2026-03-25T00:00:00.000Z",
    },
  });
  assert.equal(payload.initial.selectedUsageRange, "week");
  assert.equal(payload.refreshed.loadingState, "idle");
});
