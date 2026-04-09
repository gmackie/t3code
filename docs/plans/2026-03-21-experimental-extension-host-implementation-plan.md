# Experimental Extension Host Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an experimental, frontend-first extension host to T3 Code so the app can render bounded, read-only workflow UI without changing provider internals, then prove it with planning and preview-oriented demos.

**Architecture:** Build the extension host inside `apps/web` first. Extensions receive read-only derived state from the existing orchestration snapshot and domain-event stream, and render into explicit UI mount points owned by the shell. Phase 2 adds host-mediated workflow launches and separate extension sessions, but does not allow raw provider interception or provider adapter plugins.

**Tech Stack:** React, TanStack Router, Zustand, existing `NativeApi` orchestration methods, existing WebSocket push events, `@t3tools/contracts`, current chat/diff/sidebar shell.

## Why This Fits T3 Code

T3 Code already has the right seams:

- `packages/contracts/src/orchestration.ts` defines the typed orchestration event model.
- `packages/contracts/src/ws.ts` already exposes `orchestration.domainEvent` as the main push channel.
- `apps/web/src/wsNativeApi.ts` already exposes `orchestration.onDomainEvent()` and snapshot fetches.
- `apps/web/src/routes/__root.tsx` already resyncs the UI from domain events instead of letting ad hoc components own transport logic.
- `apps/web/src/session-logic.ts` already derives useful workflow state such as pending approvals, actionable plans, and settled-turn detection.
- `apps/web/src/components/PlanSidebar.tsx` already proves the app wants richer artifact-oriented side UI.

The extension host should sit above those seams, not beside them.

## Scope Boundaries

### In scope for v0

- Experimental internal API only
- Built-in extensions shipped from the repo
- Frontend-rendered extension surfaces
- Read-only access to projected thread/session/workflow state
- Host-defined workflow launch actions exposed by the shell
- Demo extensions for planning and preview use cases

### Explicitly out of scope for v0

- Third-party provider adapters
- Raw provider event interception
- Event-log mutation by extensions
- Unattended background automations
- Remote/VPS execution
- Marketplace/distribution story
- Stability guarantees for extension APIs

## Target User Value

This host should make it possible to prototype:

1. A planning workbench that turns thread state and proposed plans into structured artifacts, requirements, and task-oriented UI.
2. A development preview panel for web apps and game-like workflows.
3. Future extension experiments that are easier than forking the app and opening a large PR.

## Demo Set

### Demo A: Extension Host Shell

Purpose:

- prove the host can mount bounded UI
- prove read-only subscriptions are enough for useful surfaces

User-facing behavior:

- chat view gains an extension rail or panel area
- built-in extensions can register panels for the active thread
- extensions receive thread/session/plan state without wiring WebSocket transport themselves

### Demo B: Planning Workbench Extension

Purpose:

- support the "feature planning -> doc writing -> requirements -> tasks -> agents" direction

User-facing behavior:

- show a planning-focused panel for the active thread
- read the latest proposed plan and derived work log state
- render sections for brief, plan, requirements, and draft tasks
- allow host-mediated actions such as "Start planning workflow" and later "Open extension session"

Important limitation:

- v0 should not directly create tasks in core orchestration state
- it can create extension-local drafts and export markdown/json artifacts

### Demo C: Preview Workspace Extension

Purpose:

- support web UI and game development workflows

User-facing behavior:

- render a preview panel bound to the active project
- start with localhost/web preview support and static iframe/webview-like rendering
- show project scripts, terminal activity, and preview URL status
- allow future desktop-only bridges for Love2D/Unity companion windows

Important limitation:

- v0 should not try to own native engine process management
- first milestone should support browser-accessible previews and host-opened local windows only

## Proposed UI Surfaces

These should be shell-owned and explicit.

### Surface 1: Thread Side Panel

Best first surface. It matches the existing `PlanSidebar` and diff/sidebar patterns in `apps/web/src/routes/_chat.$threadId.tsx`.

Use cases:

- planning workbench
- preview inspector
- requirements/doc viewer

### Surface 2: Thread Header Actions

Small extension-provided buttons or badges in the active thread header area.

Use cases:

- "Open Planning Workbench"
- "Open Preview"
- "Open Requirements"

### Surface 3: Project Tool View

A project-level panel for preview-oriented or workflow-oriented extensions.

Use cases:

- preview server status
- game/web runner controls
- pipeline overview

Recommendation:

- implement Surface 1 first
- add Surface 2 in the same phase if cheap
- defer Surface 3 to a follow-up once the host works

## Proposed Read-Only Extension API

Do not expose raw transport. Expose a host-owned context object.

### New web-only types

Create:

- `apps/web/src/extensions/types.ts`
- `apps/web/src/extensions/context.ts`
- `apps/web/src/extensions/registry.ts`

Suggested shape:

```ts
import type { OrchestrationReadModel, ThreadId, TurnId } from "@t3tools/contracts";

import type {
  ActivePlanState,
  LatestProposedPlanState,
  PendingApproval,
  PendingUserInput,
  WorkLogEntry,
} from "../session-logic";
import type { Thread, Project } from "../types";

export type ExtensionSurface = "thread.sidePanel" | "thread.headerActions" | "project.toolView";

export interface ExtensionThreadView {
  thread: Thread | null;
  project: Project | null;
  activePlan: ActivePlanState | null;
  latestProposedPlan: LatestProposedPlanState | null;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  workLog: WorkLogEntry[];
  latestTurnId: TurnId | null;
  readModel: OrchestrationReadModel;
}

export interface HostWorkflowAction {
  id: "planning.start" | "preview.open" | "extensionSession.start";
  label: string;
  disabled?: boolean;
  run: () => Promise<void>;
}

export interface ExtensionContext {
  readonly activeThreadId: ThreadId | null;
  readonly threadView: ExtensionThreadView | null;
  readonly openSidePanel: (panelId: string) => void;
  readonly closeSidePanel: () => void;
  readonly actions: ReadonlyArray<HostWorkflowAction>;
}

export interface T3ExtensionDefinition {
  id: string;
  title: string;
  surface: ExtensionSurface;
  order?: number;
  isAvailable: (context: ExtensionContext) => boolean;
  render: (context: ExtensionContext) => React.ReactNode;
}
```

Key rule:

- extensions read derived state only
- host actions are the only write-capable path

## Proposed Host Architecture

### New files

Create:

- `apps/web/src/extensions/types.ts`
- `apps/web/src/extensions/context.ts`
- `apps/web/src/extensions/registry.ts`
- `apps/web/src/extensions/ExtensionHost.tsx`
- `apps/web/src/extensions/ExtensionSidePanel.tsx`
- `apps/web/src/extensions/builtins/planningWorkbench.tsx`
- `apps/web/src/extensions/builtins/previewWorkspace.tsx`
- `apps/web/src/extensions/extensionSelectors.ts`
- `apps/web/src/extensions/extensionStateStore.ts`
- `apps/web/src/extensions/registry.test.ts`
- `apps/web/src/extensions/extensionSelectors.test.ts`

Modify:

- `apps/web/src/routes/_chat.$threadId.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/store.ts` if a stable extension-facing selector hook is needed

### Host responsibilities

`ExtensionHost.tsx`

- resolve built-in extension registry
- compute extension context for the active thread
- filter unavailable extensions
- own open/close state for extension side panel

`extensionSelectors.ts`

- map app store state + `session-logic.ts` derived helpers into extension-safe read models
- centralize derived state so extensions do not duplicate logic

`ExtensionSidePanel.tsx`

- render the active extension panel using the existing side-panel layout patterns
- keep the shell in control of sizing, focus, and panel chrome

## Host-Mediated Actions for v0 and v1

### v0 actions

Safe actions only:

- open extension panel
- open diff panel
- open editor/external URL via existing shell bridge
- save generated markdown to workspace via `projects.writeFile`

### v1 actions

Still host-owned:

- launch a named workflow
- start a separate extension session
- attach generated artifact references back into thread UI

Avoid these words in the public proposal:

- intercept
- middleware
- plugin hooks into provider traffic

Prefer:

- host-mediated workflow launches
- separate extension sessions
- extension-originated artifacts

## Phase Plan

### Phase 1: Extension Host Skeleton

Goal:

- prove the shell can host built-in extensions without changing orchestration behavior

Implementation:

1. Add extension registry/types/context modules under `apps/web/src/extensions/`.
2. Add extension-facing selectors built from `useStore()` and `session-logic.ts`.
3. Add a side-panel host that can render one active extension.
4. Add header actions to open/close the panel for available extensions.
5. Ship a trivial diagnostic extension first.

Verification:

- extension appears only when a thread is active
- no direct WebSocket subscriptions inside extension components
- snapshot/domain-event flow remains unchanged

### Phase 2: Planning Workbench Demo

Goal:

- prove the host can support plan-based task workflows without mutating orchestration state

Implementation:

1. Add `planningWorkbench.tsx` built on top of latest proposed plan, active plan, approvals, and work log state.
2. Render sections:
   - current objective
   - latest plan
   - extracted requirements
   - draft tasks
3. Add export actions:
   - copy markdown/json
   - save artifacts to workspace
4. Add host-defined action button placeholders for future workflow launches.

Useful first artifact files:

- `feature-brief.md`
- `requirements.md`
- `task-draft.json`

Verification:

- extension remains useful with only read-only thread state
- exported artifacts are reproducible from the same thread state

### Phase 3: Preview Workspace Demo

Goal:

- prove extension panels can support domain-specific development workflows

Implementation:

1. Add `previewWorkspace.tsx`.
2. Read active project scripts from the project model already synced into `apps/web/src/store.ts`.
3. Allow configuring a preview target URL per project or per thread in extension-local state.
4. Render:
   - preview iframe for safe localhost/http(s) URLs
   - project script shortcuts
   - terminal activity indicators
   - link to open externally in desktop/browser
5. Keep all process execution outside the extension. Use existing project scripts and terminal flows.

Initial supported workflows:

- web dev server preview
- WebGL preview
- external native preview launcher button

Deferred:

- direct Love2D process control
- direct Unity Editor embedding

### Phase 4: Separate Extension Sessions

Goal:

- allow extensions to request a host-mediated session without touching provider internals directly

Implementation:

1. Add a small host action abstraction in the web shell.
2. Introduce an "extension session" concept in the web client first.
3. Back it with existing orchestration commands rather than a new provider layer.
4. Associate extension-generated artifacts with the source thread in UI only at first.

Important rule:

- the host creates the session
- the extension requests it
- the extension never speaks directly to provider adapters

This phase should not be in the initial public proposal. It should be documented as a follow-up once Phase 1 and 2 prove value.

## Demo Walkthroughs

### Demo 1: Planning Flow

1. Open a thread with an existing proposed plan.
2. Click `Planning Workbench`.
3. Review latest plan, pending approvals, and work log summary.
4. Generate and save `requirements.md`.
5. Export draft task JSON.
6. Later phase: click `Start Extension Session` to refine requirements in a dedicated flow.

### Demo 2: Web Preview Flow

1. Open a project thread.
2. Click `Preview Workspace`.
3. Configure `http://localhost:3000`.
4. Run project dev script from existing UI/terminal flows.
5. See terminal activity while preview loads in-panel.
6. Open externally if desktop/browser embedding is insufficient.

### Demo 3: Game Workflow Flow

1. Open a game-oriented project thread.
2. Click `Preview Workspace`.
3. Configure WebGL preview URL or native launcher command metadata.
4. Use project scripts to launch build/watch steps.
5. Use the extension as the project-specific control surface.

This is enough to support the idea of Love2D/Unity-oriented UI without claiming native engine integration too early.

## Testing Strategy

Do not start with broad integration tests. Lock the selector and registry behavior first.

### Add unit tests

Create:

- `apps/web/src/extensions/registry.test.ts`
- `apps/web/src/extensions/extensionSelectors.test.ts`

Test:

- extension availability filtering
- ordering by surface and `order`
- derived thread view output from realistic store state
- planning workbench artifact extraction logic
- preview extension URL validation and fallback behavior

### Add component tests if needed

Create:

- `apps/web/src/extensions/ExtensionHost.test.tsx`
- `apps/web/src/extensions/ExtensionSidePanel.test.tsx`

Test:

- panel open/close
- unavailable extensions not rendered
- switching active thread updates extension context

### Reuse existing test seams

- `apps/web/src/wsNativeApi.test.ts`
- `apps/web/src/session-logic.test.ts`
- `apps/web/src/store.test.ts`

These should remain the source of truth for transport, derived session state, and read-model syncing.

## Verification Commands

Run after each implementation batch:

```bash
bun fmt
```

Expected:

- formatting changes only

```bash
bun lint
```

Expected:

- no lint errors

```bash
bun typecheck
```

Expected:

- no type errors

For test batches:

```bash
bun run test apps/web/src/extensions/registry.test.ts
```

```bash
bun run test apps/web/src/extensions/extensionSelectors.test.ts
```

```bash
bun run test apps/web/src/store.test.ts apps/web/src/session-logic.test.ts apps/web/src/wsNativeApi.test.ts
```

Expected:

- new extension tests pass
- no regressions in current snapshot/event flow

## Concrete Task Breakdown

### Task 1: Create extension type system and registry

**Files:**

- Create: `apps/web/src/extensions/types.ts`
- Create: `apps/web/src/extensions/context.ts`
- Create: `apps/web/src/extensions/registry.ts`
- Test: `apps/web/src/extensions/registry.test.ts`

Steps:

1. Write failing registry tests for registration, ordering, and availability filtering.
2. Add the minimal extension types and registry helpers.
3. Re-run tests until they pass.
4. Commit.

### Task 2: Create extension selectors over current store state

**Files:**

- Create: `apps/web/src/extensions/extensionSelectors.ts`
- Test: `apps/web/src/extensions/extensionSelectors.test.ts`
- Reference: `apps/web/src/store.ts`
- Reference: `apps/web/src/session-logic.ts`

Steps:

1. Write failing tests that build an extension-safe thread view from realistic mock thread/project state.
2. Implement selectors using existing derived helpers.
3. Ensure no selector reaches into transport or DOM concerns.
4. Commit.

### Task 3: Mount the extension side panel in chat shell

**Files:**

- Create: `apps/web/src/extensions/ExtensionHost.tsx`
- Create: `apps/web/src/extensions/ExtensionSidePanel.tsx`
- Modify: `apps/web/src/routes/_chat.$threadId.tsx`
- Modify: `apps/web/src/components/ChatView.tsx`

Steps:

1. Add a failing component test for panel open/close if needed.
2. Render the host adjacent to the existing chat/diff layout.
3. Add host-owned state for the active extension panel.
4. Commit.

### Task 4: Ship built-in planning workbench demo

**Files:**

- Create: `apps/web/src/extensions/builtins/planningWorkbench.tsx`
- Modify: `apps/web/src/extensions/registry.ts`
- Optional test: `apps/web/src/extensions/planningWorkbench.test.tsx`

Steps:

1. Add pure artifact-extraction helpers and tests first.
2. Render plan/requirements/task draft sections from read-only context.
3. Add workspace export actions through existing `projects.writeFile`.
4. Commit.

### Task 5: Ship built-in preview workspace demo

**Files:**

- Create: `apps/web/src/extensions/builtins/previewWorkspace.tsx`
- Modify: `apps/web/src/extensions/registry.ts`
- Optional test: `apps/web/src/extensions/previewWorkspace.test.tsx`

Steps:

1. Add URL validation and preview-state tests first.
2. Render preview panel with safe URL embedding and external-open fallback.
3. Show project scripts and terminal activity as read-only context plus host actions.
4. Commit.

### Task 6: Add host action abstraction for future extension sessions

**Files:**

- Modify: `apps/web/src/extensions/types.ts`
- Modify: `apps/web/src/extensions/context.ts`
- Modify: `apps/web/src/extensions/ExtensionHost.tsx`

Steps:

1. Introduce host-defined action identifiers and a stable invocation surface.
2. Keep all implementations shell-owned and conservative.
3. Stub `extensionSession.start` behind a feature flag or no-op marker for now.
4. Commit.

## Public Proposal Guidance

If this becomes a GitHub issue later, pitch it as:

- an experimental extension host
- frontend-first
- read-only over projected orchestration state
- intended to reduce forks and exploratory PR pressure
- explicitly not a provider marketplace

Lead with the smallest useful thing:

- side-panel mount points
- read-only selectors over current thread/project state
- one planning demo
- one preview demo

That is much more likely to land than "plugin system" or "extension ecosystem."
