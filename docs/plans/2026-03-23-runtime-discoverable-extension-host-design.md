# Runtime-Discoverable Extension Host Design

## Summary

T3 Code already has the beginning of an extension model:

- `packages/extension-api` defines a stable, read-only panel contract.
- `apps/web/src/extensions/*` hosts built-in side panels.
- `packages/ext-*` shows how some UI concerns can be packaged separately.

That work proves the app can render bounded extension UI, but it is still a build-time, in-repo system. The next step is a runtime-discoverable extension host that lets extensions be managed outside the T3 Code repo while integrating with explicit host seams.

This document proposes that host and narrows the first PR to a realistic slice.

## Problem Statement

The current extension model has four structural limits:

1. Discovery is static. Extensions are imported directly into `apps/web` and registered in code.
2. Surface area is too narrow. The host only models `thread.sidePanel`, not general UI composition points.
3. Capability boundaries are implicit. Built-ins can call `readNativeApi()` directly and import app internals.
4. External packaging is not real yet. Some logic is packaged, but the app still owns registration, resolution, and execution.

If T3 Code wants an extension story that contributors can manage outside this repo, the host needs:

- runtime discovery
- explicit manifests
- explicit host-owned UI slots
- explicit capability declarations
- host-mediated privileged actions

## Design Goals

### Primary goals

- Allow extensions to be installed and discovered at runtime without patching `apps/web`.
- Keep the first version predictable and safe under failure.
- Support externally managed extension packages while preserving host control over layout and privileged behavior.
- Provide a path for extensions to inject or replace selected UI areas, not only add side panels.

### Non-goals for the first PR

- Marketplace/distribution UX
- Remote extension loading from URLs
- Arbitrary provider interception
- Background automations
- Full trustless sandboxing
- Stable long-term plugin API guarantees

## Recommended Architecture

Use a split runtime-discovery model.

### Layer 1: Public extension contract

`packages/extension-api` remains the stable public contract. It should evolve from a panel-only API into a host API that defines:

- extension manifest types
- slot identifiers
- read-only view models for thread/project/chat surfaces
- host action request types
- capability declarations

This package should remain schema/types first. Avoid coupling it to app-specific stores or transport details.

### Layer 2: Server-side discovery and registry authority

`apps/server` discovers installed extensions from configured directories, reads manifests without executing arbitrary extension code, validates them, normalizes them, and publishes a registry snapshot to clients.

The server is the authority for:

- where extensions are discovered from
- whether an extension is compatible with the current host version
- what capabilities it declares
- whether the extension is enabled or disabled

The server should never trust extension metadata blindly. Discovery failures should degrade into disabled extensions, not startup failures.

### Layer 3: Web-side runtime host

`apps/web` consumes the registry as data, resolves eligible extensions for the current UI slots, and lazily loads client entry modules only for extensions that are safe to render in the browser shell.

The web app owns:

- slot rendering order
- layout
- extension error boundaries
- fallback UI for disabled or crashed extensions
- translation of host-owned actions into existing app/native/server requests

The web app should not discover extension packages from disk directly.

## UI Model: Slots, Not Arbitrary Mutation

The host should move from a single `thread.sidePanel` surface to a slot model.

Extensions target explicit slots such as:

- `thread.sidePanel`
- `threads.sidebar.section`
- `thread.header.actions`
- `chat.composer.before`
- `chat.composer.after`
- `chat.timeline.item.after`

The host decides which slots support additive rendering versus replacement.

### Additive slots

Examples:

- sidebar sections
- header actions
- composer adornments
- side panel tabs

These are the safest first step and should dominate the initial design.

### Replaceable slots

Some host UI may eventually support controlled replacement, but replacement should only happen for named host-owned seams, for example:

- `thread.header.summaryCard`
- `threads.sidebar.primaryMeta`

The rule should be:

- extensions can replace only slots the host explicitly marks as replaceable
- the host always owns fallback rendering
- replacement never means arbitrary access to app internals or DOM mutation

## Capability Model

Default deny.

An extension can always:

- declare metadata
- target supported slots
- receive read-only host props for those slots

Anything else must be declared and granted through host-owned capabilities.

Recommended initial capabilities:

- `read.thread-view`
- `read.threads-list`
- `action.open-external-url`
- `action.request-workspace-write`
- `action.browser-tab-intent`

Important constraint:

- extensions do not get direct `readNativeApi()` access
- extensions do not import app stores directly
- extensions do not call server methods directly

Instead, they request actions through host APIs. The host validates the capability and performs the action.

## Manifest Shape

Each extension should ship a manifest that can be read without executing extension code.

Suggested manifest fields:

- `id`
- `name`
- `version`
- `description`
- `hostVersionRange`
- `clientEntries`
- `slots`
- `capabilities`
- `keywords`

The manifest should be schema-validated on the server. Invalid manifests become disabled registry entries with explicit reasons.

## Runtime Flow

1. Server scans configured extension directories.
2. Server finds and parses extension manifests.
3. Server validates manifests and builds a normalized registry.
4. Server publishes the registry snapshot to connected clients.
5. Web app filters registry entries by slot, enablement, and context.
6. Web app lazily loads client entry modules for eligible extensions.
7. Loaded extensions render only inside host-owned slot boundaries.
8. Privileged actions go back through host APIs with capability checks.

## Failure Model

The host must assume extensions will fail.

Expected failure cases:

- manifest parse failures
- incompatible host versions
- missing client bundles
- extension render errors
- capability request denials

Required behavior:

- one bad extension must not break the shell
- disabled extensions should remain visible in diagnostics where useful
- render failures should trip extension-local error UI, not unmount the host

`apps/web/src/extensions/PanelHost.tsx` already has a panel error boundary. The same pattern should be generalized across all extension slots.

## Migration of Existing Built-Ins

Current built-ins fall into two groups.

### Already close to target

- Thread overview
- Planning workbench logic
- Preview metadata helpers
- Browser metadata helpers

### Need host-action extraction

- Planning workbench file writes
- Preview/browser native interactions
- Any future UI that touches app stores directly

The migration path should be:

1. keep built-ins working
2. move ambient app access behind host action interfaces
3. then load them through the same runtime registry model as external extensions

The goal is not to special-case built-ins forever. Built-ins should become first-party extensions running through the same host contract.

## First PR Scope

The first PR should be intentionally smaller than “full plugin platform”.

### In scope

- schema-backed extension manifest in `packages/extension-api`
- server-side discovery of local extension manifests
- server-published extension registry snapshot
- web-side runtime loader for safe client slot modules
- slot host for:
  - `thread.sidePanel`
  - `threads.sidebar.section`
  - `thread.header.actions`
- one migrated example extension using read-only state plus one host action
- clear disabled/error states

### Out of scope

- composer/timeline injection implementation
- arbitrary slot replacement
- privileged extension execution outside the host action boundary
- remote install UX
- extension marketplace

## Pull Request Framing

This work should be framed as:

“Introduce a runtime-discoverable extension host with explicit UI slots and host-mediated capabilities, creating a path for externally managed extensions to integrate with T3 Code without patching core UI.”

Avoid claiming:

- a complete plugin system
- arbitrary third-party privileged execution
- a stable forever API

Good phrasing:

- “runtime-discoverable extension host”
- “explicit composition slots”
- “read-only UI contracts”
- “host-mediated capability boundary”
- “path for externally managed extensions”

## Why This Fits T3 Code

This design aligns with the current architecture:

- `apps/server` already brokers client/server/native boundaries over WebSocket.
- `packages/contracts` already centralizes schema-driven contracts.
- `packages/extension-api` already exists as a public seam.
- `apps/web` already projects orchestration state into extension-safe read models.

The main architectural shift is not inventing extensions from nothing. It is tightening and formalizing the seams so the current in-repo host can become a runtime-discoverable host without leaking app internals.

## Recommended Next Step

Implement the first PR slice around:

- manifest schemas
- server discovery
- registry sync
- three initial slots
- one migrated example extension

That is enough to support a serious PR discussion and show the direction without overcommitting the codebase to a much larger plugin platform rewrite.
