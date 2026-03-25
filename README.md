# PulseDock

PulseDock is a Windows-first Electron tray app for monitoring local AI coding usage.

It currently supports:

- Codex usage from local session files
- Cursor usage from local desktop auth and export data
- compact tray popup UI
- provider-specific detail views
- manual refresh

## Install

PulseDock is currently distributed through GitHub Releases as a Windows installer.

1. Open the latest release on [GitHub Releases](https://github.com/kyzer1023/PulseDock/releases).
2. Download `PulseDock-Setup-<version>.exe`.
3. Run the installer and complete the setup flow.

This first public release is unsigned. Windows SmartScreen may warn before launch. Use `More info` then `Run anyway` if you trust the release source.

Updates are manual for v1. Download and install the newest release over the existing install when a new version is published.

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

Typecheck:

```powershell
npm run typecheck
```

Build:

```powershell
npm run build
```

Package an unpacked Windows build:

```powershell
npx electron-builder --dir
```

Build the installer used for GitHub Releases:

```powershell
npm run dist
```

The installer is written to `release/` as `PulseDock-Setup-<version>.exe`.

## Notes

PulseDock reads real local data directly through reusable provider modules from sibling `codexstats` and `cstats` packages rather than going through a CLI bridge.
