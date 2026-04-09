# Bob-T3 Code Integration Testing Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a complete automated and manual test plan for Bob-backed T3 Code orchestration so the integration can be shipped with clear acceptance criteria, observable final-state behavior, and reliable regression coverage.

**Architecture:** Treat T3 Code as the reference orchestration/UI model and Bob as the backend adapting toward it. Validate the integration in layers: canonical event mapping, run/read-model projection, UI rendering, interaction behavior, and hosted smoke coverage against the live Bob deployment. Keep native APIs in place for v1; test the compatibility projection rather than forcing raw protocol parity.

**Tech Stack:** T3 Code (Bun, Vitest, Effect, WebSocket orchestration, extension host), Bob (pnpm, Vitest, Playwright, Next.js, tRPC, gateway WebSocket), hosted Bob environment at `https://bob.tail1e1a32.ts.net`

## Overview

This plan is not only about adding tests. It is also the acceptance contract for the finished integration.

The integration is considered complete when all of the following are true:

1. Bob emits a T3 Code-shaped orchestration event stream suitable for T3 Code's orchestration projection layer.
2. T3 Code can consume Bob-backed orchestration data and render a coherent run overlay attached to a root thread.
3. Multi-agent execution is visible through an agent-centric graph, inspector, and root-thread orchestration markers.
4. The same Bob-native execution/planning flow remains intact in Bob's own product shell.
5. The hosted Bob environment can be manually exercised using a stable smoke checklist with clear expected behavior before and after sign-in.

This document covers both:

- the testing work to add now
- the final-state behavior that must be visible when the integration is done

## Current Baseline

Before implementation begins, the plan assumes the following current state:

- T3 Code already has:
  - orchestration domain events on `orchestration.domainEvent`
  - extension-host infrastructure in `packages/extension-api` and `apps/web/src/extensions/*`
  - thread-centric UI with side-panel hosting and orchestration snapshots
- Bob already has:
  - a planning dashboard and mission-control shell at `apps/web/src/app/(dashboard)/planning/page.tsx`
  - a chat surface at `apps/web/src/app/(dashboard)/chat/page.tsx`
  - lifecycle timeline components under `apps/web/src/components/work-items/*`
  - a thin Bob -> T3 Code event bridge in `apps/gateway/src/agents/t3code-event-map.ts`
  - task-run hierarchy and lifecycle design work in `docs/plans/2026-03-25-smol-agent-phase2b-shape-run-hierarchy.md`
- Hosted Bob at `https://bob.tail1e1a32.ts.net` currently:
  - redirects `/` to `/planning`
  - redirects unauthenticated `/planning` traffic to `/login`

The plan below should verify both the current assumptions and the intended post-integration behavior.

## Final State Expectations

The final state should look like this from a user and operator perspective.

### 1. Entry behavior

- Visiting the hosted Bob URL while signed out lands on `/login`.
- After successful sign-in, the user can reach `/planning` and navigate into Bob's normal dashboard/work-item flows.
- If the same backend is being consumed by a T3 Code-compatible shell, the authenticated user can also reach a T3 Code-style thread UI backed by Bob orchestration data.

### 2. Root-thread orchestration behavior

- A normal root thread/session starts as an ordinary chat.
- When Bob-backed orchestration becomes multi-step or multi-agent, the root thread gains a `run` overlay.
- The root timeline shows orchestration markers such as:
  - agent spawned
  - task assigned
  - task blocked
  - approval requested
  - user input requested
  - artifact produced
  - child work completed or failed

### 3. Run graph behavior

- A `Run` side panel is available for threads with attached orchestration.
- The run graph renders agent/thread nodes only in v1.
- Each node shows:
  - agent identity / label
  - runtime status
  - compact task summary
  - latest relevant state
- The graph supports both:
  - `Map` mode for stable structure
  - `Live` mode for runtime emphasis and status changes

### 4. Node inspector behavior

- Selecting an agent node opens an inspector view.
- The inspector shows:
  - role / description / directives
  - skills / tools / model / sandbox / approval posture
  - backing thread/session link
  - current task summary
  - latest artifacts
  - waits, blockers, pending approvals, pending input

### 5. Bob compatibility behavior

- Bob-native work items remain work-item-first in Bob.
- Bob task runs, lifecycle events, and sessions are projected into the canonical orchestration model without erasing Bob-native semantics.
- Planning and execution both use the same canonical run/agent/task model in the integration layer.
- Bob can drive T3 Code-style orchestration UI without a separate bespoke frontend contract.

### 6. Stability behavior

- One malformed or unexpected Bob event must not break the T3 Code shell.
- A missing child-thread link should degrade into visible fallback UI, not a blank panel or crash.
- Event ordering issues should surface as stable warnings or degraded state, not infinite spinners or duplicated nodes.

## Acceptance Matrix

The integration is only done when all rows below pass.

| Area                    | Passing condition                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Canonical event mapping | Bob emits all required v1 event families and payload keys needed by T3 Code projection |
| Read-model projection   | T3 Code can build stable run/agent/task/artifact/link state from Bob events            |
| Thread overlay UX       | Root thread correctly gains and updates a run overlay                                  |
| Graph UX                | Agent graph renders, updates, and remains navigable under live event flow              |
| Inspector UX            | Node selection consistently shows agent/task/runtime detail                            |
| Request handling        | Approval and user-input events render and resolve correctly                            |
| Artifact handling       | Produced plans/files/diffs/checkpoints/links appear in the right surfaces              |
| Bob-native UX           | Bob planning/work-item/chat flows still work in Bob's own shell                        |
| Hosted smoke            | Live Bob deployment passes auth, navigation, planning, and orchestration smoke tests   |

## Test Strategy

Use five layers of verification.

### Layer 1: Pure unit tests

Purpose:

- verify deterministic mapping and selector logic
- validate event-to-state reduction
- validate host read-model construction

### Layer 2: Contract tests

Purpose:

- enforce the required Bob -> canonical event payload shape
- freeze expected T3 Code-side projection inputs

### Layer 3: Integration tests

Purpose:

- run reducer/ingestion/projection paths end-to-end in memory
- verify snapshot assembly, overlay state, and event ordering behavior

### Layer 4: UI component and route tests

Purpose:

- verify graph, inspector, root-thread markers, and extension-host rendering
- verify no regressions in existing plan/sidebar/session surfaces

### Layer 5: E2E and hosted smoke tests

Purpose:

- validate real auth gates, real navigation, real websocket/event behavior, and live deployment expectations

## Task 1: Freeze the canonical event contract in tests

**Files:**

- Create: `apps/gateway/src/agents/__tests__/t3code-event-map.contract.test.ts`
- Modify: `/Volumes/dev/bob/apps/gateway/src/agents/t3code-event-map.ts`
- Reference: `/Volumes/dev/t3code/docs/plans/2026-03-26-multi-agent-bob-t3code-compat-design.md`

**Step 1: Write the failing contract tests**

Create `apps/gateway/src/agents/__tests__/t3code-event-map.contract.test.ts` with table-driven cases for:

- thread message start/delta/completed/failure
- run started/updated/completed/failed
- agent spawned/updated/completed/failed
- task assigned/progressed/blocked/completed/failed/reassigned
- request opened/resolved
- user input requested/resolved
- artifact produced/updated/promoted
- link created

Minimal shape example:

```ts
import { describe, expect, it } from "vitest";

import { bobEventToT3 } from "../t3code-event-map";

describe("Bob -> T3 canonical event contract", () => {
  it("maps a Bob run-started event into a canonical run.started event", () => {
    const mapped = bobEventToT3(
      {
        type: "event",
        sessionId: "session-1",
        seq: 1,
        eventType: "state",
        direction: "system",
        payload: {
          orchestrationType: "run_started",
          runId: "run-1",
          state: "running",
        },
        createdAt: "2026-03-27T00:00:00.000Z",
      },
      "thread-1",
    );

    expect(mapped).toMatchObject({
      type: "run.started",
      threadId: "thread-1",
      runId: "run-1",
    });
  });
});
```

**Step 2: Run the focused test**

Run: `cd /Volumes/dev/bob && pnpm vitest apps/gateway/src/agents/__tests__/t3code-event-map.contract.test.ts`

Expected: FAIL because the mapper is currently too thin and does not emit the canonical v1 event families.

**Step 3: Expand the mapper shape**

Modify `apps/gateway/src/agents/t3code-event-map.ts` so it can express the canonical v1 event families required by the integration design. Keep Bob-native source events intact, but project them into the richer orchestration taxonomy.

**Step 4: Re-run the focused test**

Run: `cd /Volumes/dev/bob && pnpm vitest apps/gateway/src/agents/__tests__/t3code-event-map.contract.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /Volumes/dev/bob
git add apps/gateway/src/agents/t3code-event-map.ts apps/gateway/src/agents/__tests__/t3code-event-map.contract.test.ts
git commit -m "test: freeze Bob to T3 orchestration event contract"
```

## Task 2: Add Bob-side reducer/projection tests for run hierarchy

**Files:**

- Create: `apps/gateway/src/agents/__tests__/orchestration-projection.test.ts`
- Modify: Bob projection/reducer files created for the integration
- Reference: `packages/db/src/schema.ts`, `runLifecycleEvents`, `taskRuns`

**Step 1: Write failing reducer/projection tests**

Cover:

- root run creation from a planning/execution start
- child agent spawn from delegation
- task attachment to agent
- blocker state from dependency or input wait
- artifact creation and linking
- mapping child task runs to child run or child agent state

Example expectation:

```ts
expect(snapshot.runs[0]).toMatchObject({
  id: "run-root",
  rootSessionId: "session-root",
  agents: [
    expect.objectContaining({
      id: "agent-child-1",
      threadId: "session-child-1",
      status: "running",
    }),
  ],
});
```

**Step 2: Run focused Bob tests**

Run: `cd /Volumes/dev/bob && pnpm vitest apps/gateway/src/agents/__tests__/orchestration-projection.test.ts`

Expected: FAIL until the projection layer exists.

**Step 3: Implement the minimal projection**

Add or extend Bob-side projection code so task runs, sessions, and lifecycle events reduce into a canonical run/agent/task/artifact graph shape.

**Step 4: Re-run focused Bob tests**

Run: `cd /Volumes/dev/bob && pnpm vitest apps/gateway/src/agents/__tests__/orchestration-projection.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /Volumes/dev/bob
git add apps/gateway/src/agents/__tests__/orchestration-projection.test.ts
git commit -m "test: cover Bob run projection hierarchy"
```

## Task 3: Add T3 Code ingestion and snapshot tests for Bob-shaped events

**Files:**

- Create: `apps/server/src/orchestration/Layers/BobCompatibilityIngestion.test.ts`
- Modify: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- Modify: supporting contracts if needed under `packages/contracts/src/*`

**Step 1: Write failing T3 Code ingestion tests**

Scenarios:

- Bob `run.started` creates run overlay state for a root thread
- Bob `agent.spawned` creates a visible agent node
- Bob `agent.task.assigned` updates agent summary
- Bob `request.opened` and `user_input.requested` surface as pending interactions
- malformed Bob payload degrades safely without crashing ingestion

**Step 2: Run focused T3 Code tests**

Run: `cd /Volumes/dev/t3code && bun vitest apps/server/src/orchestration/Layers/BobCompatibilityIngestion.test.ts`

Expected: FAIL until the ingestion path understands Bob-compatible orchestration events.

**Step 3: Implement the minimal compatibility ingestion**

Extend the orchestration ingestion layer to accept Bob-projected events and reduce them into T3 Code's orchestration snapshot state.

**Step 4: Re-run the focused test**

Run: `cd /Volumes/dev/t3code && bun vitest apps/server/src/orchestration/Layers/BobCompatibilityIngestion.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /Volumes/dev/t3code
git add apps/server/src/orchestration/Layers/BobCompatibilityIngestion.test.ts apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts packages/contracts/src
git commit -m "test: cover Bob-compatible orchestration ingestion"
```

## Task 4: Add T3 Code UI selector tests for run overlay state

**Files:**

- Create: `apps/web/src/extensions/orchestrationSelectors.test.ts`
- Create or Modify: `apps/web/src/extensions/orchestrationSelectors.ts`
- Modify: `apps/web/src/extensions/panelSelectors.ts` if needed

**Step 1: Write failing selector tests**

Cover:

- thread with no run overlay
- thread with root run overlay
- child agent summary extraction
- pending approvals and user input attached to run/agent
- artifact summary extraction for inspector

**Step 2: Run the focused test**

Run: `cd /Volumes/dev/t3code && bun vitest apps/web/src/extensions/orchestrationSelectors.test.ts`

Expected: FAIL until selectors exist.

**Step 3: Implement minimal selectors**

Create stable selector utilities that translate orchestration snapshot state into graph-friendly and inspector-friendly read models.

**Step 4: Re-run the focused test**

Run: `cd /Volumes/dev/t3code && bun vitest apps/web/src/extensions/orchestrationSelectors.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /Volumes/dev/t3code
git add apps/web/src/extensions/orchestrationSelectors.ts apps/web/src/extensions/orchestrationSelectors.test.ts apps/web/src/extensions/panelSelectors.ts
git commit -m "test: add run overlay selector coverage"
```

## Task 5: Add graph and inspector component tests

**Files:**

- Create: `apps/web/src/extensions/builtins/orchestrationGraph.test.tsx`
- Create: `apps/web/src/extensions/builtins/orchestrationInspector.test.tsx`
- Create or Modify: graph/inspector implementation files under `apps/web/src/extensions/builtins/*`

**Step 1: Write failing component tests**

Test that:

- graph renders agent nodes from selector input
- `Map` and `Live` mode toggles render correctly
- selecting a node updates inspector state
- missing thread links show fallback state instead of crash
- blocked/failed/waiting states produce visible status indicators

**Step 2: Run focused tests**

Run:

```bash
cd /Volumes/dev/t3code
bun vitest apps/web/src/extensions/builtins/orchestrationGraph.test.tsx apps/web/src/extensions/builtins/orchestrationInspector.test.tsx
```

Expected: FAIL until components exist.

**Step 3: Implement minimal graph and inspector**

Build the v1 graph as agent/thread nodes only. Keep tasks nested inside summaries and the inspector.

**Step 4: Re-run focused tests**

Run:

```bash
cd /Volumes/dev/t3code
bun vitest apps/web/src/extensions/builtins/orchestrationGraph.test.tsx apps/web/src/extensions/builtins/orchestrationInspector.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
cd /Volumes/dev/t3code
git add apps/web/src/extensions/builtins
git commit -m "test: cover orchestration graph and inspector UI"
```

## Task 6: Add root-thread orchestration marker tests

**Files:**

- Create: `apps/web/src/components/ChatView.orchestrationMarkers.test.tsx`
- Modify: `apps/web/src/components/ChatView.tsx` or extracted timeline marker components

**Step 1: Write failing tests**

Verify the root timeline shows markers for:

- agent spawned
- task blocked
- approval requested
- user input requested
- artifact produced
- child work completed

**Step 2: Run focused test**

Run: `cd /Volumes/dev/t3code && bun vitest apps/web/src/components/ChatView.orchestrationMarkers.test.tsx`

Expected: FAIL until markers are rendered.

**Step 3: Implement minimal markers**

Render lightweight orchestration chips or rows in the root thread timeline using canonical event summaries.

**Step 4: Re-run focused test**

Run: `cd /Volumes/dev/t3code && bun vitest apps/web/src/components/ChatView.orchestrationMarkers.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
cd /Volumes/dev/t3code
git add apps/web/src/components/ChatView.tsx apps/web/src/components/ChatView.orchestrationMarkers.test.tsx
git commit -m "test: cover root thread orchestration markers"
```

## Task 7: Add Bob route-level integration tests for preserved product behavior

**Files:**

- Create: `apps/web/e2e/specs/bob-t3code-compat-planning.spec.ts`
- Create: `apps/web/e2e/specs/bob-t3code-compat-chat.spec.ts`
- Reference: `apps/web/src/app/(dashboard)/planning/page.tsx`, `apps/web/src/app/(dashboard)/chat/page.tsx`, `apps/web/src/app/(dashboard)/work-items/[workItemId]/workflow-page-client.tsx`

**Step 1: Write failing route-level E2E specs**

Cover:

- unauthenticated `/planning` redirects to `/login`
- authenticated planning page loads dashboard/projects shell
- a linked work item can open workflow detail and lifecycle timeline
- a chat session still works in Bob-native UI after compatibility changes

**Step 2: Run focused Playwright specs**

Run:

```bash
cd /Volumes/dev/bob
pnpm --filter @bob/web playwright test apps/web/e2e/specs/bob-t3code-compat-planning.spec.ts apps/web/e2e/specs/bob-t3code-compat-chat.spec.ts
```

Expected: initial failures or skips depending on auth fixtures and current integration state.

**Step 3: Implement only what the tests require**

Keep Bob-native routes working while compatibility surfaces are added.

**Step 4: Re-run focused Playwright specs**

Expected: PASS or documented auth-gated PASS path using the repo's standard auth setup.

**Step 5: Commit**

```bash
cd /Volumes/dev/bob
git add apps/web/e2e/specs/bob-t3code-compat-planning.spec.ts apps/web/e2e/specs/bob-t3code-compat-chat.spec.ts
git commit -m "test: add Bob compatibility route coverage"
```

## Task 8: Add hosted smoke checklist for the live Bob deployment

**Files:**

- Create: `/Volumes/dev/bob/docs/manual-testing-bob-t3code-integration.md`
- Reference: hosted environment `https://bob.tail1e1a32.ts.net`

**Step 1: Write the hosted smoke checklist**

Include explicit manual steps with pass/fail expectations for:

- signed-out access:
  - visit `/`
  - expect redirect to `/planning`
  - expect redirect to `/login`
- sign-in:
  - complete login flow
  - expect authenticated return path to `/planning` or intended dashboard entry
- planning shell:
  - dashboard/projects tabs render
  - workspace/project data loads
- work item workflow:
  - workflow detail loads
  - lifecycle timeline visible when data exists
- orchestration:
  - multi-agent run overlay or equivalent orchestration surface appears when a run exists
  - root-thread/run state matches backend activity

**Step 2: Add explicit evidence requirements**

Every hosted smoke run should capture:

- URL visited
- timestamp
- environment name
- screenshots or screen recordings
- any console/network errors
- whether orchestration state was real or fixture-backed

**Step 3: Commit**

```bash
cd /Volumes/dev/bob
git add docs/manual-testing-bob-t3code-integration.md
git commit -m "docs: add hosted Bob to T3 Code smoke checklist"
```

## Task 9: Add final verification scripts and CI expectations

**Files:**

- Modify: CI configs in both repos as needed
- Modify: repo docs if verification commands change

**Step 1: Define verification commands**

T3 Code required verification:

```bash
cd /Volumes/dev/t3code
bun fmt
bun lint
bun typecheck
```

Bob expected verification:

```bash
cd /Volumes/dev/bob
pnpm lint
pnpm typecheck
pnpm vitest
pnpm --filter @bob/web playwright test
```

If full Playwright is too expensive for every PR, define the minimum PR lane plus a nightly or pre-release lane.

**Step 2: Gate integration merge on the contract suite**

The Bob -> T3 Code event contract tests and the T3 Code ingestion tests must run in the default CI path.

**Step 3: Commit**

```bash
git add .
git commit -m "ci: gate Bob to T3 compatibility verification"
```

## Manual Final-State Test Cases

These are the user-visible acceptance scenarios that must pass before calling the integration complete.

### Scenario A: Signed-out hosted access

1. Open `https://bob.tail1e1a32.ts.net`
2. Observe redirect chain to `/planning`, then `/login`

Expected:

- no broken intermediate page
- no infinite redirect
- login page renders successfully

### Scenario B: Signed-in planning entry

1. Sign in on hosted Bob
2. Land on `/planning`
3. Verify dashboard/projects shell loads

Expected:

- page does not stall on loading state
- workspace/project data appears
- top-level navigation remains Bob-native

### Scenario C: Bob-native workflow detail

1. Open a work item with workflow detail
2. Confirm lifecycle timeline loads
3. Confirm dispatch/review state still works

Expected:

- compatibility changes do not break Bob-native work-item UX
- lifecycle and task-run state still appear in Bob terms where appropriate

### Scenario D: Bob-backed T3 Code orchestration view

1. Open a root thread/session with active orchestration
2. Confirm run overlay appears
3. Open the `Run` side panel
4. Toggle `Map` and `Live`
5. Select an agent node

Expected:

- graph renders agent/thread nodes
- statuses update without layout collapse
- inspector shows runtime and capability details
- selecting a node gives a thread/session link

### Scenario E: Requests and waits

1. Trigger approval-required or user-input-required behavior
2. Observe root-thread orchestration marker and agent/node status
3. Resolve the request

Expected:

- request is visible in both summary and detail surfaces
- resolution clears wait state
- no duplicated or stale pending state remains

### Scenario F: Artifact production

1. Produce a plan, diff, patch, checkpoint, or linkable output
2. Observe the artifact in the orchestration surfaces

Expected:

- artifact appears in the relevant timeline/inspector/location
- linked entities open correctly
- artifact does not get orphaned from the run or agent that produced it

## Exit Criteria

The integration may be called complete only when all of the following are true:

- Bob contract tests pass.
- Bob run projection tests pass.
- T3 Code ingestion tests pass.
- T3 Code graph, inspector, and timeline marker tests pass.
- Bob route-level E2E tests pass.
- Hosted smoke checklist passes on `https://bob.tail1e1a32.ts.net`.
- T3 Code verification commands pass:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`
- Bob verification commands pass for the agreed CI lane.

## Notes

- The hosted Bob smoke plan should not assume anonymous access to real orchestration data.
- If auth bypass remains necessary for automation, preserve that as a test harness detail only; the manual hosted smoke must use the real sign-in flow.
- If graph rendering proves too unstable for the first integrated slice, the graph may ship behind a feature flag, but the underlying run overlay and event/read-model tests must still be complete.

Plan complete and saved to `docs/plans/2026-03-27-bob-t3code-integration-testing-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
