# Runtime-Discoverable Extension Host Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce the first PR slice of a runtime-discoverable extension host for T3 Code, with server-discovered manifests, a client-consumed registry, explicit UI slots, and a host-mediated capability boundary for safe extension actions.

**Architecture:** Extend `packages/extension-api` from a panel-only contract into a schema-backed extension host contract. `apps/server` becomes the discovery and registry authority. `apps/web` consumes the normalized registry, loads eligible client slot modules, and renders them through host-owned slot components instead of hardcoded built-in imports.

**Tech Stack:** TypeScript, React, Effect Schema, existing WebSocket request/push transport, existing server config/runtime services, existing web extension host and panel selectors.

## Scope Guardrails

- Keep the first implementation to local runtime discovery from configured directories.
- Support only safe client-rendered slot modules in v1.
- Add additive slots first:
  - `thread.sidePanel`
  - `threads.sidebar.section`
  - `thread.header.actions`
- Migrate one extension through the new flow before broad refactors.
- Do not implement direct `readNativeApi()` access for discovered extensions.

## Task 1: Define the extension manifest and slot contract

**Files:**

- Modify: `packages/extension-api/src/index.ts`
- Test: `packages/extension-api/src/index.test.ts` or `packages/contracts/src/*.test.ts` if tests must live elsewhere

**Step 1: Write the failing test**

Add tests that define the desired schema behavior:

- valid manifest parses successfully
- invalid slot names fail validation
- unknown capability names fail validation
- missing required client entry fields fail validation

Use exact examples for:

- a side panel extension
- a sidebar section extension
- a header action extension

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test packages/extension-api/src/index.test.ts
```

Expected:

- FAIL because manifest schema/types do not exist yet

**Step 3: Write minimal implementation**

In `packages/extension-api/src/index.ts`, add:

- `ExtensionSlot`
- `ExtensionCapability`
- `DiscoveredExtensionManifest`
- `DiscoveredExtensionClientEntry`
- any related helper types needed by web/server

Keep this package contract-only. Do not add runtime discovery logic here.

**Step 4: Run test to verify it passes**

Run:

```bash
bun run test packages/extension-api/src/index.test.ts
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add packages/extension-api/src/index.ts packages/extension-api/src/index.test.ts
git commit -m "feat: define runtime extension manifest contract"
```

## Task 2: Add server config for extension discovery roots

**Files:**

- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/main.ts` if config plumbing is centralized there
- Test: `apps/server/src/config.test.ts` if present, otherwise add a focused test file

**Step 1: Write the failing test**

Add tests for:

- default discovery roots resolve correctly
- explicit env/config values are parsed correctly
- empty or invalid roots are rejected or normalized

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test apps/server/src/config.test.ts
```

Expected:

- FAIL because extension discovery roots are not defined

**Step 3: Write minimal implementation**

Add configuration for one or more extension directories, for example:

- user-level extensions directory
- optional workspace-local extensions directory

Normalize paths during config load.

**Step 4: Run test to verify it passes**

Run the same test command and confirm PASS.

**Step 5: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/config.test.ts apps/server/src/main.ts
git commit -m "feat: add extension discovery config"
```

## Task 3: Implement server-side discovery and manifest validation

**Files:**

- Create: `apps/server/src/extensions/discovery.ts`
- Create: `apps/server/src/extensions/discovery.test.ts`
- Create: `apps/server/src/extensions/types.ts` if server-local types are useful

**Step 1: Write the failing test**

Add discovery tests covering:

- finds valid manifests under configured roots
- ignores unrelated files
- marks invalid manifests as disabled with reasons
- marks incompatible versions as disabled with reasons
- preserves deterministic ordering

Use fixture directories under `apps/server/src/extensions/__fixtures__/` if needed.

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test apps/server/src/extensions/discovery.test.ts
```

Expected:

- FAIL because discovery implementation does not exist

**Step 3: Write minimal implementation**

Implement:

- directory scan
- manifest file read
- schema validation using the contract from `packages/extension-api`
- normalized discovery result shape

Do not execute extension code during discovery.

**Step 4: Run test to verify it passes**

Run the same focused test command and confirm PASS.

**Step 5: Commit**

```bash
git add apps/server/src/extensions/discovery.ts apps/server/src/extensions/discovery.test.ts apps/server/src/extensions
git commit -m "feat: discover and validate local extensions"
```

## Task 4: Expose extension registry data over the existing server transport

**Files:**

- Modify: `packages/contracts/src/ws.ts`
- Modify: `apps/server/src/wsServer.ts`
- Modify: relevant server tests such as `apps/server/src/wsServer.test.ts`

**Step 1: Write the failing test**

Add transport-level tests for:

- fetching the current extension registry snapshot
- pushing registry updates when discovery results change, if implementing live refresh
- preserving disabled-state metadata

Prefer adding one request/response method first. Live refresh can be follow-up if it risks scope.

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test apps/server/src/wsServer.test.ts
```

Expected:

- FAIL because extension registry route/channel is missing

**Step 3: Write minimal implementation**

Add:

- a new WS method or initial snapshot path for extension registry data
- response encoding/decoding
- server integration with the discovery service

If live refresh is deferred, document that the first version uses snapshot fetch on app load.

**Step 4: Run test to verify it passes**

Run the same server test command and confirm PASS.

**Step 5: Commit**

```bash
git add packages/contracts/src/ws.ts apps/server/src/wsServer.ts apps/server/src/wsServer.test.ts
git commit -m "feat: expose extension registry over websocket"
```

## Task 5: Replace the hardcoded panel registry with a registry-driven slot model

**Files:**

- Modify: `apps/web/src/extensions/types.ts`
- Modify: `apps/web/src/extensions/registry.ts`
- Modify: `apps/web/src/extensions/panelRegistry.ts`
- Create: `apps/web/src/extensions/slotRegistry.ts`
- Create: `apps/web/src/extensions/runtimeTypes.ts`
- Test: `apps/web/src/extensions/registry.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- filtering discovered extensions by slot
- ordering by declared order and title
- ignoring disabled or incompatible entries
- keeping built-ins and discovered entries composable during migration

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test apps/web/src/extensions/registry.test.ts
```

Expected:

- FAIL because the registry still assumes static built-in panels only

**Step 3: Write minimal implementation**

Refactor the web extension host data model to support:

- slot identifiers
- discovered manifest metadata
- client entry metadata
- migration coexistence with current built-ins

Keep rendering behavior stable for existing side panels while the slot model is introduced.

**Step 4: Run test to verify it passes**

Run the same focused test and confirm PASS.

**Step 5: Commit**

```bash
git add apps/web/src/extensions/types.ts apps/web/src/extensions/registry.ts apps/web/src/extensions/panelRegistry.ts apps/web/src/extensions/slotRegistry.ts apps/web/src/extensions/runtimeTypes.ts apps/web/src/extensions/registry.test.ts
git commit -m "refactor: model extensions as registry-driven slots"
```

## Task 6: Add client-side registry fetch and store

**Files:**

- Create: `apps/web/src/extensions/extensionRegistryStore.ts`
- Create: `apps/web/src/extensions/useExtensionRegistry.ts`
- Modify: `apps/web/src/nativeApi.ts` or `apps/web/src/wsNativeApi.ts`
- Modify: `apps/web/src/routes/__root.tsx`
- Test: `apps/web/src/extensions/extensionRegistryStore.test.ts`

**Step 1: Write the failing test**

Cover:

- initial registry fetch
- loading/error state
- storing disabled entries and reasons
- preserving stable ordering

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test apps/web/src/extensions/extensionRegistryStore.test.ts
```

Expected:

- FAIL because no registry store/fetch flow exists

**Step 3: Write minimal implementation**

Add:

- a registry fetcher wired to the new WS method
- a small store for discovered extension metadata
- root-level hydration on app startup

Defer live-refresh subscriptions unless they are cheap and well-tested.

**Step 4: Run test to verify it passes**

Run the same focused test and confirm PASS.

**Step 5: Commit**

```bash
git add apps/web/src/extensions/extensionRegistryStore.ts apps/web/src/extensions/useExtensionRegistry.ts apps/web/src/nativeApi.ts apps/web/src/wsNativeApi.ts apps/web/src/routes/__root.tsx apps/web/src/extensions/extensionRegistryStore.test.ts
git commit -m "feat: hydrate discovered extension registry in web app"
```

## Task 7: Add host-owned slot components

**Files:**

- Modify: `apps/web/src/extensions/PanelHost.tsx`
- Create: `apps/web/src/extensions/ThreadHeaderActionHost.tsx`
- Create: `apps/web/src/extensions/ThreadsSidebarSectionHost.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/components/ChatView.tsx`
- Test: `apps/web/src/extensions/PanelHost.test.ts`

**Step 1: Write the failing test**

Add tests for:

- side panel slot still renders correctly
- header actions render in declared order
- sidebar sections render in declared order
- extension render errors are isolated per slot

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test apps/web/src/extensions/PanelHost.test.ts
```

Expected:

- FAIL because only the side panel host exists today

**Step 3: Write minimal implementation**

Implement host-owned slot renderers for:

- `thread.sidePanel`
- `thread.header.actions`
- `threads.sidebar.section`

Keep layout ownership in the host. Extension components only return slot content.

**Step 4: Run test to verify it passes**

Run the same focused test and confirm PASS.

**Step 5: Commit**

```bash
git add apps/web/src/extensions/PanelHost.tsx apps/web/src/extensions/ThreadHeaderActionHost.tsx apps/web/src/extensions/ThreadsSidebarSectionHost.tsx apps/web/src/components/Sidebar.tsx apps/web/src/components/ChatView.tsx apps/web/src/extensions/PanelHost.test.ts
git commit -m "feat: add extension slot hosts for header and sidebar"
```

## Task 8: Add a host-mediated capability API and remove ambient access from one example extension

**Files:**

- Modify: `packages/extension-api/src/index.ts`
- Create: `apps/web/src/extensions/hostActions.ts`
- Modify: `apps/web/src/extensions/builtins/threadOverview.tsx` or another simple candidate
- Modify: one extension package under `packages/ext-*` if needed
- Test: `apps/web/src/extensions/hostActions.test.ts`

**Step 1: Write the failing test**

Cover:

- capability-gated host action invocation
- denied capability behavior
- successful action request behavior

Choose one action for the first example, preferably:

- `open-external-url`, or
- `request-workspace-write`

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test apps/web/src/extensions/hostActions.test.ts
```

Expected:

- FAIL because host actions do not exist

**Step 3: Write minimal implementation**

Add a host action interface that discovered extensions receive instead of raw app internals.

Migrate one example extension to use that interface. Avoid starting with browser/preview if that balloons scope.

**Step 4: Run test to verify it passes**

Run the same focused test and confirm PASS.

**Step 5: Commit**

```bash
git add packages/extension-api/src/index.ts apps/web/src/extensions/hostActions.ts apps/web/src/extensions/builtins apps/web/src/extensions/hostActions.test.ts packages/ext-*
git commit -m "feat: add host-mediated extension actions"
```

## Task 9: Add one discovered extension fixture and end-to-end runtime path

**Files:**

- Create: fixture manifest/bundle files under a local example directory such as `examples/extensions/` or server test fixtures
- Modify: `apps/web/src/extensions/panelRegistry.ts` if migration fallback is still needed
- Add/modify integration tests in web/server as appropriate

**Step 1: Write the failing test**

Add an integration test that proves:

- the server discovers a local manifest
- the client hydrates it
- the slot host renders it in the right place

**Step 2: Run test to verify it fails**

Run the narrow integration test command you add.

Expected:

- FAIL because the end-to-end path is incomplete

**Step 3: Write minimal implementation**

Wire one full example through the discovery path. Prefer a simple read-only extension with one host action instead of a complex browser-style extension.

**Step 4: Run test to verify it passes**

Run the same focused integration test and confirm PASS.

**Step 5: Commit**

```bash
git add examples/extensions apps/server/src/extensions apps/web/src/extensions
git commit -m "feat: prove discovered extension through runtime host"
```

## Task 10: Update proposal docs and migration notes

**Files:**

- Modify: `README.md`
- Modify: `docs/plans/2026-03-21-extension-host-proposal.md`
- Modify: `docs/plans/2026-03-21-browser-as-extension-proposal.md`
- Add: follow-up migration note if needed

**Step 1: Write the docs diff**

Update documentation to distinguish:

- previous frontend-first built-in panel host
- new runtime-discoverable extension host direction
- current v1 scope boundaries

**Step 2: Verify docs match the implementation**

Check that slot names, capability names, and discovery behavior exactly match code.

**Step 3: Commit**

```bash
git add README.md docs/plans/2026-03-21-extension-host-proposal.md docs/plans/2026-03-21-browser-as-extension-proposal.md
git commit -m "docs: describe runtime-discoverable extension host"
```

## Verification Before Completion

Run all required project checks before claiming completion:

```bash
bun fmt
bun lint
bun typecheck
```

Run focused tests as each task lands, then run a broader regression sweep appropriate to touched areas:

```bash
bun run test apps/server/src/extensions/discovery.test.ts
bun run test apps/server/src/wsServer.test.ts
bun run test apps/web/src/extensions/registry.test.ts
bun run test apps/web/src/extensions/PanelHost.test.ts
```

Do not run `bun test`. Use `bun run test`.

## PR Positioning

Describe the first PR as:

- a runtime-discoverable extension host foundation
- explicit UI slots for safe composition
- host-mediated capabilities for extension actions
- a path for externally managed extensions

Do not describe it as:

- a finished plugin platform
- arbitrary third-party code execution with native privileges
- a stable final extension API

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-23-runtime-discoverable-extension-host-implementation-plan.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
