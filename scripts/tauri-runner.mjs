import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const tauriCliRoot = path.dirname(require.resolve("@tauri-apps/cli/package.json"));
const tauriEntry = path.join(tauriCliRoot, "tauri.js");
const subcommand = process.argv[2];

if (!subcommand) {
  throw new Error("Missing Tauri subcommand. Expected `dev` or `build`.");
}

function findLlvmMingwBin() {
  const toolsRoot = path.join(projectRoot, "tools");
  if (!fs.existsSync(toolsRoot)) {
    return null;
  }

  const match = fs
    .readdirSync(toolsRoot, { withFileTypes: true })
    .find(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith("llvm-mingw-") &&
        entry.name.endsWith("x86_64"),
    );

  if (!match) {
    return null;
  }

  return path.join(toolsRoot, match.name, "bin");
}

function hasMsvcToolchain() {
  if (process.platform !== "win32") {
    return false;
  }

  const whereResult = spawnSync("where.exe", ["link.exe"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "ignore",
  });

  if (whereResult.status === 0) {
    return true;
  }

  const vswherePath = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
  if (!fs.existsSync(vswherePath)) {
    return false;
  }

  const vswhereResult = spawnSync(
    vswherePath,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ],
    {
      cwd: projectRoot,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );

  return vswhereResult.status === 0 && Boolean(vswhereResult.stdout.trim());
}

function runTauri(extraArgs = [], extraEnv = {}) {
  const result = spawnSync(process.execPath, [tauriEntry, subcommand, ...extraArgs], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PATH: `${process.env.USERPROFILE}\\.cargo\\bin;${process.env.PATH}`,
      ...extraEnv,
    },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

const llvmMingwBin = findLlvmMingwBin();
const msvcAvailable = hasMsvcToolchain();
let result = msvcAvailable ? runTauri() : { status: 1 };

if (result.status !== 0 && process.platform === "win32") {
  if (llvmMingwBin) {
    if (msvcAvailable) {
      process.stderr.write(
        "MSVC toolchain path failed; retrying Tauri with the portable gnullvm toolchain.\n",
      );
    }

    result = runTauri(
      ["--target", "x86_64-pc-windows-gnullvm"],
      {
        PATH: `${llvmMingwBin};${process.env.USERPROFILE}\\.cargo\\bin;${process.env.PATH}`,
        RUSTUP_TOOLCHAIN: "stable-x86_64-pc-windows-gnullvm",
        CARGO_TARGET_X86_64_PC_WINDOWS_GNULLVM_LINKER: "clang",
        CC: "clang",
        CXX: "clang++",
      },
    );
  } else if (!msvcAvailable) {
    process.stderr.write(
      "No usable Windows Rust toolchain was found. Install Visual C++ Build Tools, or place an llvm-mingw x86_64 bundle under the local tools/ directory.\n",
    );
  }
}

process.exit(result.status ?? 1);
