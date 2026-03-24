# PulseDock UI Design Brief

This brief defines the v1 tray popup UI before implementation.

Figma MCP note: the local Figma connector currently returns `Auth required`, so this design is derived directly from [`plan.md`](C:\Users\kyzer\OneDrive\Documents\CS_USM\PulseDock\plan.md) and is intended to be translated into Figma or code once the connector is authenticated.

## Product Intent

PulseDock should feel like a native Windows tray utility:

- fast to open
- compact enough for tray usage
- glanceable in under 5 seconds
- credible as a monitoring tool, not a mini website

The UI should prioritize:

1. estimated cost
2. recent usage volume
3. provider health or warning state
4. last refresh confidence

## Popup Frame

- Width: 388px
- Height: auto, capped at 560px before internal scroll
- Outer padding: 12px
- Corner radius: 18px
- Window shadow: soft, wide, elevated
- Hide on blur: yes
- Resize: no

Why 388px:

- wide enough for two-column metric rows
- still believable as a tray popup
- avoids turning into a dashboard panel

## Visual Direction

Theme name: Graphite Signal

- Background: layered charcoal surfaces instead of flat black
- Accent color: teal for active/healthy data
- Secondary accent: amber for warnings/stale states
- Error accent: muted red, only when needed
- Surface treatment: subtle gradients and thin inner borders
- Tone: analytical, quiet, precise

Suggested palette:

- `bg-app`: `#111417`
- `bg-panel`: `#171B1F`
- `bg-elevated`: `#1D2328`
- `border-soft`: `#2A3238`
- `text-strong`: `#F3F6F7`
- `text-muted`: `#9CA8AF`
- `text-dim`: `#6F7B83`
- `accent-teal`: `#34D1BF`
- `accent-amber`: `#F2B766`
- `accent-red`: `#E06C75`

## Typography

Use a compact, technical voice.

- Title: 15px semibold
- Section label: 11px uppercase with letter spacing
- Large metric: 28px semibold, tight tracking
- Card title: 13px semibold
- Body metric label: 11px
- Body metric value: 12px medium
- Meta text: 10px

If a custom font is added later, favor a narrow grotesk or technical sans. Until then, use the best native Windows sans available in the stack.

## Information Architecture

The popup should be split into five zones:

1. Header
2. Combined snapshot
3. Provider cards
4. Warnings or status strip
5. Footer meta

### 1. Header

Purpose: orient the user immediately and expose refresh.

Content:

- PulseDock wordmark/title
- small tray subtitle: `Local AI usage monitor`
- refresh icon button
- optional small activity dot while refreshing

Behavior:

- refresh is always visible
- on refresh, icon spins and cards preserve previous values until new data arrives

### 2. Combined Snapshot

Purpose: provide a single-glance answer before the user reads provider details.

Layout:

- a prominent summary tile directly under the header
- left side shows total estimated cost for the current window
- right side shows total tokens
- bottom edge shows the active window label such as `Last 7 days`

Content:

- primary value: combined estimated cost
- secondary value: combined tokens
- small line: `2 providers loaded` or `1 of 2 providers loaded`

This section should feel denser and brighter than the provider cards.

### 3. Provider Cards

Two stacked cards:

- Codex
- Cursor

Each card includes:

- provider badge/icon area
- provider name
- status pill: `Fresh`, `Stale`, `Warning`, or `Error`
- large estimated cost
- compact metric grid

Metric grid fields for v1:

- Total tokens
- Top model/provider
- Sessions or active days
- Last updated

Card layout rule:

- top row: identity + status
- middle row: large cost
- bottom row: 2x2 compact metrics

Warnings:

- if provider has warnings, show up to one warning line inline
- if more than one exists, summarize as `2 warnings`

### 4. Warnings / Status Strip

Purpose: centralize app-level trust signals without expanding the popup.

Show only when needed:

- partial refresh succeeded
- pricing snapshot may be stale
- Cursor auth requires attention
- provider data missing

Style:

- full-width strip between cards and footer
- amber background tint for warnings
- red tint for hard failures

### 5. Footer Meta

Purpose: close with provenance and recency.

Content:

- `Last refreshed 2m ago`
- short provenance note such as `Codex local sessions + Cursor export`

This should stay low contrast.

## Wireframe

```text
+--------------------------------------------------+
| PulseDock                           [Refresh]    |
| Local AI usage monitor                            |
|                                                  |
|  TOTAL EST. COST                  TOTAL TOKENS   |
|  $14.28                           1.92M          |
|  Last 7 days                      2 providers    |
|                                                  |
|  [Codex]                        [Fresh]          |
|  $8.91                                           |
|  Tokens         Top model                        |
|  1.12M          gpt-5.4                          |
|  Sessions       Updated                          |
|  12             1m ago                           |
|                                                  |
|  [Cursor]                       [Warning]        |
|  $5.37                                           |
|  Tokens         Top provider                     |
|  804k           Anthropic                        |
|  Active days    Updated                          |
|  5              3m ago                           |
|  Auth refreshed; pricing may be approximate      |
|                                                  |
|  Warning: 1 of 2 providers returned stale data   |
|                                                  |
|  Last refreshed 1m ago                           |
|  Codex local sessions + Cursor export            |
+--------------------------------------------------+
```

## Interaction Rules

Tray behavior:

- Left click tray icon opens popup near tray position
- Clicking outside closes popup
- Re-clicking tray icon toggles popup

Refresh:

- manual refresh only in v1
- cards keep previous data while loading
- show subtle busy indicator, not a full blocking overlay

Card behavior:

- provider cards are not expandable in v1
- entire card may become clickable later, but v1 should not imply navigation

Empty and failure handling:

- never show a blank popup
- if both providers fail, keep the header and show one clear recovery state

## State Designs

### Loading

- show real header and summary shell
- provider cards use skeleton lines
- preserve last successful `Last refreshed` if available

### Partial Success

- render successful provider normally
- failed provider shows compact error card
- warning strip explains partial refresh

### Full Error

- replace cards with a single recovery panel
- include human-readable action such as `Try refresh again`

### Empty / First Run

- summary tile becomes onboarding message:
  `No usage loaded yet`
- cards show provider-specific hints:
  `Codex session data not found`
  `Cursor usage requires auth/export data`

### Stale Data

- keep normal layout
- switch status pill to amber
- footer explains last successful refresh time

## Component Inventory

Target component set for implementation:

- `TrayShell`
- `PopupHeader`
- `SummaryHero`
- `ProviderCard`
- `MetricCell`
- `StatusPill`
- `InlineWarning`
- `StatusStrip`
- `EmptyStatePanel`
- `ErrorStatePanel`
- `FooterMeta`

## Spacing System

Use tight spacing so the popup remains readable at tray scale.

- outer gap: 12px
- section gap: 10px
- card padding: 12px
- internal metric gap: 8px
- inline label/value gap: 4px

## Motion

Keep motion sparse and purposeful.

- popup appear: short fade + upward drift, 140ms
- refresh icon: linear spin while loading
- card state transitions: soft opacity shift, 120ms

Avoid bouncing or playful motion. This is utility software.

## Windows-Specific Notes

- design for 100% and 125% scaling first
- maintain clear contrast on Windows translucent backdrops
- avoid tiny click targets; minimum 32x32px for refresh
- do not rely on hover-only affordances

## v1 Implementation Guidance

When coding this:

- start with fake data and all five state variants
- lock spacing and typography before wiring charts or settings
- do not add a sidebar, tabs, or full dashboard shell
- do not collapse both providers into a generic table

## Deferred Until After v1

- daily mini chart
- compact vs expanded mode
- filters and date range picker
- settings surface
- notifications and thresholds
- drill-in details
