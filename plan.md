# PulseDock Plan

## Product Decision

PulseDock will be a Windows-first Electron desktop app.

That decision is now fixed for v1. The remaining design work is about:

- tray UX and popup behavior
- how data is extracted from Codex and Cursor
- how pricing is estimated and kept maintainable
- how much logic should be reused directly from `codexstats` and `cstats`

## Goal

PulseDock should provide a fast tray-based view of local usage and estimated cost for:

- Codex
- Cursor

The app should make recent usage visible without requiring the terminal and should feel like a native Windows tray utility rather than a full desktop dashboard.

## Product Direction

PulseDock should:

- live in the system tray
- open a compact popup on click
- show glanceable summaries for both providers
- support manual refresh
- optionally support auto-refresh later
- hide when focus is lost
- stay lightweight in startup and idle behavior

This is a Windows-first app from day one. Cross-platform support is not a v1 requirement.

## Confirmed Tech Stack

### Desktop Shell

- Electron
- React
- TypeScript
- Vite

### Packaging

- electron-builder

### UI

- compact React UI optimized for tray popup usage
- lightweight charting only if it materially improves the popup
- no full website-style shell for v1

## Reference Implementations

PulseDock should treat these sibling projects as the starting point for domain logic:

- `../codexstats`
- `../cstats`

These external repos are also useful architectural references:

- `steipete/CodexBar`
- `robinebers/openusage`

They are not just inspiration. They are the first concrete references for:

- local data discovery
- usage extraction
- normalization
- pricing estimation
- warning handling

PulseDock should reuse or adapt those implementations where sensible rather than re-deriving the logic from scratch.

## Architectural Lessons From Existing Apps

### What To Take From `CodexBar`

Useful patterns:

- clear separation between provider/core code and app/menu UI
- provider registry and provider-specific fetch contexts
- background refresh feeding a shared store/UI snapshot
- strong handling of multiple provider-specific fallback paths

What not to copy for PulseDock v1:

- macOS-only menu bar, WebKit, and Keychain assumptions
- browser-cookie and web-dashboard flows as the primary Cursor path
- CLI RPC and PTY probing as the primary Codex path

### What To Take From `openusage`

Useful patterns:

- host-owned fs/http/sqlite/auth primitives
- provider probes returning one normalized UI-facing result shape
- strict separation between shell/runtime concerns and provider logic
- per-provider caching/logging boundaries

What not to copy for PulseDock v1:

- the full plugin runtime and VM layer
- `ccusage` runner indirection for local token usage
- extra abstraction that slows down the first Windows implementation

### PulseDock Interpretation

PulseDock should borrow:

- `CodexBar`'s separation of provider logic from shell/UI
- `openusage`'s normalized provider output contract

PulseDock should not adopt:

- a browser-cookie-first architecture
- a CLI bridge layer
- a plugin engine in v1

## What Existing Tools Already Do

### Codex via `codexstats`

Current behavior worth reusing:

- discovers local Codex session data under `CODEX_HOME/sessions` or `~/.codex/sessions`
- parses rollout/session files
- recovers token deltas from cumulative `token_count` events
- normalizes usage and session metadata
- estimates API-equivalent cost from a bundled pricing snapshot

Likely PulseDock reuse targets in `codexstats`:

- discovery and home resolution
- rollout loading/parsing
- usage normalization
- pricing estimate and model mapping
- summary aggregation

### Cursor via `cstats`

Current behavior worth reusing:

- reads local Cursor auth state from `state.vscdb`
- refreshes auth when needed
- calls Cursor's usage export endpoint
- parses exported usage rows
- aggregates totals by date/model/provider
- estimates cost from a built-in pricing manifest

Likely PulseDock reuse targets in `cstats`:

- auth extraction and token refresh flow
- export fetch logic
- CSV parsing and aggregation
- pricing manifest and estimation logic

### Codex in `CodexBar` and `openusage`

Important takeaways:

- both validate that Codex auth and usage can be handled without a terminal UI
- both treat OAuth-backed account usage and local token usage as separate concerns
- `CodexBar` adds many extra fallback paths, but those are mostly Mac-specific
- `openusage` proves a normalized host-to-provider contract, but currently uses a `ccusage` wrapper for local token usage

PulseDock direction:

- use direct local file parsing for token and cost stats
- do not make CLI RPC, PTY, or browser scraping the primary Codex path
- keep optional account-limit or dashboard-style integrations as future expansion only

### Cursor in `CodexBar` and `openusage`

Important takeaways:

- `CodexBar` is largely cookie/web-session driven for Cursor, which does not match the preferred Windows path
- `openusage` is closer to `cstats`: it reads desktop auth, refreshes tokens, and calls Cursor APIs directly
- both confirm that Cursor integration needs a stronger isolation boundary than Codex because it is more brittle and more provider-specific

PulseDock direction:

- use Windows desktop auth state as the primary source
- use direct API/export calls after auth resolution
- avoid browser-cookie and web-session scraping as the primary architecture
- keep the Cursor adapter isolated behind a stable internal contract

## Provider Strategy

### Codex: Local-First

Primary v1 path:

- scan local rollout/session files
- normalize token usage into one internal event model
- estimate cost from a versioned local pricing manifest
- summarize into UI-facing provider snapshots

Do not depend on:

- browser cookies
- web scraping
- CLI PTY parsing

### Cursor: Desktop-Auth-First

Primary v1 path:

- read auth from Windows Cursor desktop state
- refresh access token when needed
- fetch usage/export data from Cursor endpoints
- parse and normalize usage into the same internal event model
- estimate cost from a local pricing manifest

Do not depend on:

- browser cookies as the primary source
- external `sqlite3` CLI long term
- loosely typed renderer-owned fetch logic

### Windows-Specific Assumptions

- Cursor desktop auth path should be treated as a Windows path first
- Codex home resolution should support `CODEX_HOME` and standard Windows user directories
- OS-specific credential-store fallback can be added later if needed, but file and desktop-state paths should drive v1

## Data Strategy

PulseDock needs a provider abstraction that hides the differences between Codex and Cursor.

Suggested app-level shape:

- provider id
- display name
- usage window
- total input tokens
- total cached input tokens if applicable
- total output tokens
- total reasoning tokens if applicable
- estimated cost
- top model or provider
- session count or active-day count
- warnings
- last refreshed at
- data provenance

The renderer should consume one normalized app-facing model regardless of where the provider data came from.

Suggested internal contract:

- `UsageProvider`
- `getSnapshot(input) -> ProviderSnapshot`
- provider-owned cache and refresh policy hidden behind the adapter

## Integration Strategy

### Stage 1: Direct Provider Modules

Skip CLI JSON integration entirely.

PulseDock should integrate provider logic as importable modules from the start:

- extract stable provider-facing functions from CLI entry points
- expose shared types
- keep each CLI as a thin wrapper around reusable modules
- let Electron call provider services directly from the main process
- prefer plain TypeScript provider services over a plugin runtime for v1

Why this is now preferred:

- avoids duplicate process startup
- keeps errors typed and provider-specific
- gives full control over refresh, caching, and partial failures
- avoids building an intermediate integration path that will be thrown away

Tradeoffs:

- requires a cleaner module boundary up front
- increases early refactor work in `codexstats` and `cstats`
- makes provider contracts a first-class design task from the beginning

### Stage 2: Provider-Specific Hardening

Refine the fragile parts of extraction after the core app works:

- replace external `sqlite3` CLI dependency used by `cstats`
- evaluate `node:sqlite` or a Node-accessible embedded SQLite solution for Cursor auth/database access
- reduce dependence on undocumented or brittle provider-specific assumptions
- improve resilience around missing sessions, expired tokens, unknown models, and pricing gaps
- decide whether a plugin architecture is justified only after the two-provider Windows core is stable

## Research Track

Deep research is justified mainly for the extraction method, not for Electron itself.

Research focus:

- how other tools read Codex local session/token usage
- how other tools obtain Cursor usage data
- whether there are safer or more direct local extraction paths than the current `cstats` flow
- how other projects handle pricing manifests, unknown models, and stale price data
- whether any provider offers a more stable export or local state surface than the current approach

Research output should be practical:

- a shortlist of extraction approaches per provider
- risks and breakage points for each approach
- recommendation for PulseDock v1
- recommendation for later hardening/refactor work
- a record of which ideas from `CodexBar` and `openusage` are intentionally adopted versus rejected

Important constraint:

- research should inform the provider module design before implementation starts
- do not start with a throwaway CLI bridge

## Architecture

### Main Process

Responsible for:

- tray creation
- popup window lifecycle
- native positioning behavior
- scheduling refreshes
- safe IPC endpoints
- secure provider orchestration
- provider cache ownership
- provider error isolation

### Preload Bridge

Responsible for:

- exposing a minimal typed API to the renderer
- preventing direct Node access from UI code
- translating IPC responses into renderer-safe structures

### Renderer Process

Responsible for:

- rendering provider cards
- loading, refreshing, and empty states
- last-updated display
- future compact charts or trend views

### Shared Domain Layer

Responsible for:

- provider adapters
- normalization into one app model
- pricing estimation hooks
- warning collection
- summary transformation for the UI

### Provider Services

Responsible for:

- Codex local discovery, parsing, normalization, pricing, and summarization
- Cursor auth resolution, refresh, fetch/export, parsing, pricing, and summarization
- hiding provider-specific fallback logic from the renderer
- returning one stable `ProviderSnapshot` shape

### Future Plugin Layer

Not a v1 requirement.

Possible later use:

- adding more providers without touching core app code
- external provider packs or community integrations

But the first implementation should stay as direct in-repo TypeScript modules.

## Initial Repository Structure

```text
PulseDock/
  plan.md
  package.json
  app/
    electron/
      main/
      preload/
    src/
      components/
      features/
      domain/
      providers/
        codex/
        cursor/
      application/
      lib/
      styles/
```

This can change once implementation settles, but it should separate Electron runtime concerns from provider/domain logic early.

## V1 Scope

### Core

- tray icon
- popup window
- Codex summary card
- Cursor summary card
- refresh button
- loading state
- error state
- last updated timestamp
- provider-specific warning display when needed

### Metrics To Show First

- total tokens
- estimated cost
- recent usage window
- top model or provider
- active days or sessions

### Nice To Have After V1

- daily chart
- date-range selector
- settings screen
- startup on boot
- notifications or thresholds
- compact versus expanded popup modes

## Risks

- Cursor auth and export flow is the most fragile integration
- `cstats` currently depends on the external `sqlite3` CLI
- provider pricing can drift from published rates
- undocumented provider data surfaces may change
- browser-cookie and dashboard-scrape approaches are tempting but would increase Windows fragility if adopted too early
- Windows tray positioning and hide-on-blur behavior can be fiddly
- background refresh must stay lightweight

## Milestones

1. Scaffold Electron + React + TypeScript + Vite in this directory.
2. Build tray icon, popup window, and preload bridge.
3. Add a fake provider-backed dashboard to validate the UI shell.
4. Define the shared `ProviderSnapshot` and `UsageProvider` contracts.
5. Extract direct provider-facing functions from `codexstats` into the Codex adapter.
6. Extract direct provider-facing functions from `cstats` into the Cursor adapter.
7. Normalize both providers into one shared renderer model.
8. Improve loading, refresh, warning, and error handling.
9. Harden the Cursor extraction path and replace fragile external dependencies.
10. Revisit whether pluginization is worth it only after the Windows two-provider core is stable.

## Immediate Next Task

Start by scaffolding the Electron app in this directory with:

- Electron
- React
- TypeScript
- Vite
- tray icon
- popup window
- preload bridge
- fake provider data

Then define the internal provider contract and wire in real provider data by importing or extracting provider modules directly from `codexstats` and `cstats`, with no CLI bridge layer, no browser-cookie-first architecture, and no plugin engine in v1.
