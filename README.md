# PulseDock

PulseDock is a Windows tray app for monitoring local AI coding usage from Codex and Cursor.

## Features

- compact tray popup with manual refresh
- combined cost and token summary
- provider-specific detail panels for Codex and Cursor
- local-data-first collection with no CLI bridge requirement
- packaged Windows installer built with Electron

## Install

PulseDock is distributed through [GitHub Releases](https://github.com/kyzer1023/PulseDock/releases).

1. Download `PulseDock-Setup-<version>.exe` from the latest release.
2. Run the installer.
3. Launch PulseDock from the Start menu or installed shortcut.

The installer is unsigned. Windows SmartScreen may warn before launch. Use `More info` and then `Run anyway` if you trust the release source.

Updates are manual for v1. Reinstall with the latest release when a new version is published.

## Stack

- Electron
- React
- TypeScript
- Vite
- electron-builder

## Development

Install dependencies:

```powershell
npm install
```

Run the app in development mode:

```powershell
npm run dev
```

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

Artifacts are written to `release/`.

## Notes

PulseDock uses a small Electron architecture:

- the main process runs provider collectors for Codex and Cursor
- those collectors read local session, auth, and usage-export files directly from disk
- a sandboxed preload script exposes a narrow IPC bridge to the renderer
- the React tray UI renders the aggregated dashboard snapshot returned by that bridge

This keeps the app local-first and avoids depending on an external CLI process just to populate the tray popup.
