# PulseDock

PulseDock is a Windows-first Electron tray app for monitoring local AI coding usage.

It currently supports:

- Codex usage from local session files
- Cursor usage from local desktop auth and export data
- compact tray popup UI
- provider-specific detail views
- manual refresh

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

## Notes

PulseDock reads real local data directly through reusable provider modules from sibling `codexstats` and `cstats` packages rather than going through a CLI bridge.
