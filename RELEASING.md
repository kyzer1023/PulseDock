# Releasing PulseDock

This repo ships PulseDock as a Windows-only GitHub Release with a Tauri-built NSIS installer.

## Release Checklist

1. Confirm the version in `package.json` and `package-lock.json`.
2. Run the release gates:

   ```powershell
   npm run typecheck
   npm test
   npm run test:packaged
   ```

3. Build the final installer:

   ```powershell
   npm run dist
   ```

4. Verify the generated artifacts under `src-tauri/target/<target>/release/`:
   - `pulsedock.exe`
   - `bundle/nsis/PulseDock_<version>_x64-setup.exe`

5. Perform manual Windows QA on the installer:
   - fresh install succeeds and shows the tray icon
   - popup renders and `Refresh` works
   - Codex and Cursor load data or show acceptable empty/error states
   - external links open expected destinations
   - tray/menu quit works
   - reinstall over an existing install behaves acceptably
   - uninstall removes the app cleanly enough for v1

6. Create a git tag that matches the version:

   ```powershell
   git tag v<version>
   git push origin v<version>
   ```

7. Create a GitHub Release for that tag and upload `PulseDock_<version>_x64-setup.exe`.
8. Write the release notes directly in GitHub and keep the SmartScreen warning in the notes.

## Release Notes Requirements

- state that the build is Windows only
- explain that updates are manual reinstall for v1
- mention that the desktop shell now uses Tauri with a packaged collector sidecar
- call out that the installer is unsigned and SmartScreen may warn
- summarize what changed in the release
- link the repository issues page for bug reports
