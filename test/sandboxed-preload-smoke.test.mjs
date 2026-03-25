import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.resolve(__dirname, "./sandboxed-preload-runner.mjs");

test("loads the PulseDock preload bridge inside a sandboxed renderer", async () => {
  const child = spawn(electronBinary, [runnerPath], {
    cwd: path.resolve(__dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutChunks = [];
  const stderrChunks = [];

  child.stdout.on("data", (chunk) => {
    stdoutChunks.push(chunk);
  });

  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk);
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });

  assert.equal(exitCode, 0, Buffer.concat(stderrChunks).toString("utf8"));

  const payload = JSON.parse(Buffer.concat(stdoutChunks).toString("utf8"));
  assert.deepEqual(payload.keys, [
    "getDashboard",
    "onDashboardChanged",
    "openExternal",
    "quitApp",
    "refreshDashboard",
  ]);
  assert.deepEqual(payload.initial, {
    providers: [],
    refreshedAt: "2026-03-25T00:00:00.000Z",
  });
  assert.deepEqual(payload.refreshed, {
    providers: [],
    refreshedAt: "2026-03-25T00:05:00.000Z",
  });
});
