import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unpackedDir = path.join(appRoot, "release-smoke", "win-unpacked");

async function resolvePackagedExe() {
  const entries = await fs.readdir(unpackedDir, { withFileTypes: true });
  const match = entries.find((entry) =>
    entry.isFile() &&
    entry.name.endsWith(".exe") &&
    !entry.name.toLowerCase().includes("uninstall")
  );

  if (!match) {
    throw new Error(`No packaged executable found under ${unpackedDir}`);
  }

  return path.join(unpackedDir, match.name);
}

test("packaged app loads the sandboxed preload bridge from the final artifact", {
  skip: process.platform !== "win32",
}, async () => {
  const exePath = await resolvePackagedExe();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulsedock-packaged-smoke-"));
  const outputPath = path.join(tempDir, "bridge-result.json");

  const child = spawn(exePath, [], {
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
  ]);
  assert.match(payload.bodyText, /Refresh/);
  assert.deepEqual(payload.initial.summary, {
    estimatedCost: 0,
    totalTokens: 0,
    providerCount: 0,
    loadedProviderCount: 0,
    usageWindow: {
      label: "Last 24h",
      since: "2026-03-24T00:00:00.000Z",
      until: "2026-03-25T00:00:00.000Z",
    },
  });
  assert.equal(payload.refreshed.loadingState, "idle");
});
