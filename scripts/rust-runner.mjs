import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

if (args.length === 0) {
  throw new Error("Missing cargo arguments.");
}

const result = spawnSync("cargo", args, {
  cwd: path.join(projectRoot, "src-tauri"),
  env: {
    ...process.env,
    PATH: `${process.env.USERPROFILE}\\.cargo\\bin;${process.env.PATH}`,
  },
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
