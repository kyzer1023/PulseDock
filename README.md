# PulseDock

PulseDock is a Windows tray app for monitoring local AI coding usage from Codex and Cursor.

## Features

- compact tray popup with manual refresh
- combined cost and token summary
- provider-specific detail panels for Codex and Cursor
- local-data-first collection with no CLI bridge requirement
- packaged Windows installer built with Tauri

## Install

PulseDock is distributed through [GitHub Releases](https://github.com/kyzer1023/PulseDock/releases).

1. Download `PulseDock_<version>_x64-setup.exe` from the latest release.
2. Run the installer.
3. Launch PulseDock from the Start menu or installed shortcut.

The installer is unsigned. Windows SmartScreen may warn before launch. Use `More info` and then `Run anyway` if you trust the release source.
PulseDock uses Tauri's WebView2-based Windows shell. Modern Windows installs usually already include WebView2; the installer will bootstrap it if needed.

Updates are manual for v1. Reinstall with the latest release when a new version is published.

## Stack

- Tauri
- React
- TypeScript
- Vite
- packaged Node sidecar

## Development

Install dependencies:

```powershell
npm install
```

Run the app in development mode:

```powershell
npm run dev
```

If you do not have Visual Studio C++ build tools available, place an `llvm-mingw` x64 toolchain under `tools/` and the repo will fall back to the `gnullvm` target automatically.

Validate the project:

```powershell
npm run typecheck
npm test
npm run test:packaged
```

Build production assets:

```powershell
npm run build
```

Build the Windows installer:

```powershell
npm run dist
```

Artifacts are written under `src-tauri/target/<target>/release/`.

## Notes

PulseDock uses a small Tauri architecture:

- the Tauri shell owns the tray, popup window, and external-link controls
- a packaged Node sidecar reuses the existing Codex and Cursor collectors
- the shell orchestrates refreshes and emits dashboard updates into the renderer bridge
- the React tray UI renders the aggregated dashboard snapshot returned by that bridge

This keeps the app local-first and avoids depending on an external CLI process just to populate the tray popup.
