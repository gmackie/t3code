# OpenPeon Local Event Bus Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a desktop-first, read-only, versioned local event bus that emits reduced local lifecycle events for external consumers such as OpenPeon.

**Architecture:** The implementation adds a new contracts-level local event schema, derives those events from existing post-normalization runtime/orchestration state in `apps/server`, and forwards them to desktop-local subscribers through a dedicated Electron IPC transport. The bus is transport-agnostic at the schema level, but the first transport lives only in the desktop app and is explicitly separate from the UI extension host work.

**Tech Stack:** TypeScript, Effect, existing orchestration runtime ingestion pipeline, WebSocket/orchestration state already in `apps/server`, Electron IPC in `apps/desktop`, Vitest, existing contracts/schema patterns in `packages/contracts`.

## Implementation Notes

- Do not add OpenPeon runtime code, CESP mapping code, sounds, or notification UI in this plan.
- Do not couple this work to `packages/extension-api` or the runtime-discoverable extension host.
- Do not emit from raw provider notifications. Emit only after T3 Code has already decided the user-visible lifecycle result.
- Keep the transport read-only in v1.
- Prefer new files over bloating `ipc.ts` or `providerRuntime.ts` further.

## Proposed File Layout

### New files

- `packages/contracts/src/localPluginEvents.ts`
- `packages/contracts/src/localPluginEvents.test.ts`
- `apps/server/src/localPluginEventBus.ts`
- `apps/server/src/localPluginEventBus.test.ts`
- `apps/desktop/src/localPluginBridge.ts`
- `apps/desktop/src/localPluginBridge.test.ts`
- `apps/desktop/src/localPluginBackendIpc.ts`
- `apps/desktop/src/localPluginBackendIpc.test.ts`

### Modified files

- `packages/contracts/src/index.ts`
- `packages/contracts/src/ipc.ts`
- `apps/server/src/main.ts`
- `apps/server/src/main.test.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/preload.ts`
- `docs/plans/2026-03-23-openpeon-local-event-bus-design.md`

## Task 1: Add the contracts-level event schema

**Files:**

- Create: `packages/contracts/src/localPluginEvents.ts`
- Create: `packages/contracts/src/localPluginEvents.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/ipc.ts`

**Step 1: Write the failing schema tests**

Create `packages/contracts/src/localPluginEvents.test.ts` with focused decode tests for:

- valid `session.started` envelope
- valid `turn.started` envelope
- valid `turn.settled` envelope with `result: "completed"`
- valid `approval.required` envelope
- valid `user-input.required` envelope
- valid `runtime.error` envelope
- valid `resource.limit` envelope
- rejection for unknown `kind`
- rejection for invalid `version`

Use the same style as `packages/contracts/src/providerRuntime.test.ts` and `packages/contracts/src/ws.test.ts`.

Example test skeleton:

```ts
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { LocalPluginEnvelope } from "./localPluginEvents";

const decode = Schema.decodeUnknownSync(LocalPluginEnvelope);

describe("LocalPluginEnvelope", () => {
  it("decodes turn.settled envelopes", () => {
    const parsed = decode({
      type: "event",
      version: 1,
      sequence: 1,
      event: {
        id: "evt-1",
        kind: "turn.settled",
        createdAt: "2026-03-23T00:00:00.000Z",
        provider: "codex",
        threadId: "thread-1",
        turnId: "turn-1",
        result: "completed",
      },
    });

    expect(parsed.event.kind).toBe("turn.settled");
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test packages/contracts/src/localPluginEvents.test.ts
```

Expected:

- failure because `./localPluginEvents` does not exist yet

**Step 3: Write the schema**

Create `packages/contracts/src/localPluginEvents.ts`.

Follow the patterns already used in:

- `packages/contracts/src/providerRuntime.ts`
- `packages/contracts/src/ws.ts`
- `packages/contracts/src/baseSchemas.ts`

Define:

- `LocalPluginEventVersion = 1`
- `LocalPluginEventBase`
- event-specific schemas:
  - `LocalPluginSessionStartedEvent`
  - `LocalPluginTurnStartedEvent`
  - `LocalPluginTurnSettledEvent`
  - `LocalPluginApprovalRequiredEvent`
  - `LocalPluginUserInputRequiredEvent`
  - `LocalPluginRuntimeErrorEvent`
  - `LocalPluginResourceLimitEvent`
- union:
  - `LocalPluginEvent`
- envelope:
  - `LocalPluginEnvelope`

Recommended types:

```ts
const LocalPluginEventKind = Schema.Literals([
  "session.started",
  "turn.started",
  "turn.settled",
  "approval.required",
  "user-input.required",
  "runtime.error",
  "resource.limit",
]);

const LocalPluginTurnResult = Schema.Literals(["completed", "failed", "interrupted", "cancelled"]);
```

Put the shared fields in the base schema:

- `id`
- `kind`
- `createdAt`
- `provider`
- `threadId`
- optional `projectId`
- optional `turnId`
- optional `summary`

For `approval.required`, include:

- optional `requestId`
- optional `requestKind`
- optional `detail`

For `user-input.required`, include:

- optional `requestId`
- `questions`

For `runtime.error`, include:

- `message`

For `resource.limit`, include:

- `limitKind`
- optional `message`

Update `packages/contracts/src/index.ts` to export `./localPluginEvents`.

In `packages/contracts/src/ipc.ts`, define a desktop-facing event listener type so Electron can expose it cleanly:

```ts
import type { LocalPluginEnvelope } from "./localPluginEvents";
```

Then extend `DesktopBridge` with:

```ts
onLocalPluginEvent: (listener: (event: LocalPluginEnvelope) => void) => () => void;
```

Do not add this to `NativeApi` yet. The first transport is desktop-only and external-consumer-facing.

**Step 4: Run tests to verify they pass**

Run:

```bash
bun run test packages/contracts/src/localPluginEvents.test.ts
```

Expected:

- PASS

Then run:

```bash
bun typecheck --filter=@t3tools/contracts
```

Expected:

- contracts package typechecks cleanly

**Step 5: Commit**

```bash
git add packages/contracts/src/localPluginEvents.ts \
  packages/contracts/src/localPluginEvents.test.ts \
  packages/contracts/src/index.ts \
  packages/contracts/src/ipc.ts
git commit -m "feat(contracts): add local plugin event schemas"
```

## Task 2: Add server-side reduction from existing lifecycle state into local plugin events

**Files:**

- Create: `apps/server/src/localPluginEventBus.ts`
- Create: `apps/server/src/localPluginEventBus.test.ts`
- Modify: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
- Modify: `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts`

**Step 1: Write the failing reducer tests**

Create `apps/server/src/localPluginEventBus.test.ts`.

Write unit tests around a pure reduction helper rather than around full server startup first.

Test cases:

- `session.started` runtime event emits one local `session.started`
- accepted `turn.started` emits one local `turn.started`
- successful `turn.completed` emits one local `turn.settled` with `result: "completed"`
- failed `turn.completed` emits one local `turn.settled` with `result: "failed"` and error summary
- `request.opened` for approval emits `approval.required`
- `user-input.requested` emits `user-input.required`
- `runtime.error` emits `runtime.error`
- rate-limit style event emits `resource.limit`
- task lifecycle events like `task.completed` emit nothing
- duplicate open approval for same request id is deduped

The reducer should accept the smallest useful input, for example:

```ts
type LocalPluginReductionInput = {
  event: ProviderRuntimeEvent;
  projectId?: string;
  acceptedByLifecycleGuard: boolean;
};
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test apps/server/src/localPluginEventBus.test.ts
```

Expected:

- failure because `localPluginEventBus.ts` does not exist yet

**Step 3: Implement the pure reducer**

Create `apps/server/src/localPluginEventBus.ts`.

Keep this file narrowly focused on local bus semantics, not transport.

Add:

- `createLocalPluginEventReducer()`
- `reduceProviderRuntimeEventToLocalPluginEnvelopes(...)`

Recommended behavior:

- emit only for the minimal event set
- map `turn.completed` to `turn.settled`
- require `acceptedByLifecycleGuard === true` for lifecycle-sensitive events
- ignore `task.started`, `task.progress`, `task.completed`, and other noisy intermediate events
- keep an in-memory dedupe set for currently open request ids so reconnect/update noise does not re-emit `approval.required`

Use helpers mirroring existing normalization in `ProviderRuntimeIngestion.ts`, not new ad hoc parsing.

Example reducer shape:

```ts
export interface LocalPluginReducer {
  readonly reduceRuntimeEvent: (input: {
    event: ProviderRuntimeEvent;
    projectId?: string;
    acceptedByLifecycleGuard: boolean;
  }) => ReadonlyArray<LocalPluginEnvelope>;
}
```

**Step 4: Integrate the reducer at the correct lifecycle boundary**

Modify `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`.

Do not publish local bus events from `CodexAdapter` or raw provider code.

Instead:

- instantiate the reducer near the ingestion worker setup
- after the same lifecycle guard decision that governs `turn.started` and `turn.completed`, feed accepted runtime events into the local reducer
- publish resulting envelopes into an internal Effect queue or callback owned by the server layer

Keep this integration minimal. The reducer output should remain internal until the next task wires transport.

If needed, introduce a tiny local event publisher function parameter in this layer rather than hard-coding desktop behavior here.

**Step 5: Add integration tests around guarded lifecycle behavior**

Extend `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts` with focused tests that prove:

- conflicting child turn completion does not emit `turn.settled`
- accepted active-turn completion does emit `turn.settled`
- approval request replays do not emit duplicate `approval.required`

Do not make the full test suite depend on Electron. Test the reducer and ingestion integration separately.

**Step 6: Run tests to verify they pass**

Run:

```bash
bun run test apps/server/src/localPluginEventBus.test.ts
bun run test apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
```

Expected:

- PASS

**Step 7: Commit**

```bash
git add apps/server/src/localPluginEventBus.ts \
  apps/server/src/localPluginEventBus.test.ts \
  apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts \
  apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
git commit -m "feat(server): derive local plugin events from runtime lifecycle"
```

## Task 3: Add a server-owned publisher seam for local plugin events

**Files:**

- Modify: `apps/server/src/wsServer.ts`
- Modify: `apps/server/src/localPluginEventBus.ts`
- Create or modify tests: `apps/server/src/wsServer.test.ts` or `apps/server/src/localPluginEventBus.test.ts`

**Step 1: Write a failing publisher integration test**

Add a test that verifies the server layer can receive a local plugin envelope from the runtime/orchestration side and make it available to a subscriber-oriented sink without going through WebSocket push channels.

If `wsServer.ts` is too heavy for this test, keep the test against a new lightweight server-local publisher abstraction.

Suggested abstraction:

```ts
export interface LocalPluginPublisher {
  publish: (event: LocalPluginEnvelope) => Effect.Effect<void>;
  stream: Stream.Stream<LocalPluginEnvelope>;
}
```

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test apps/server/src/localPluginEventBus.test.ts
```

Expected:

- failure because publisher abstraction is missing

**Step 3: Implement the publisher**

Use an internal `PubSub` in `apps/server/src/localPluginEventBus.ts`, following the same pattern as:

- `apps/server/src/orchestration/Layers/RuntimeReceiptBus.ts`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts`

Expose:

- a publish function
- a `Stream` for subscribers

Then plumb that publisher into `ProviderRuntimeIngestion.ts` so reduced envelopes are published there.

If server layer composition needs a service tag, add one in the same file or a small companion service file. Keep the naming local and precise, for example:

- `LocalPluginEventPublisher`

**Step 4: Verify no WebSocket coupling is introduced**

Do not add a `WS_CHANNELS.localPluginEvent`.

This plan is desktop-only transport for external local consumers. WebSocket browser transport is intentionally out of scope.

**Step 5: Run tests to verify they pass**

Run:

```bash
bun run test apps/server/src/localPluginEventBus.test.ts
```

Expected:

- PASS

**Step 6: Commit**

```bash
git add apps/server/src/localPluginEventBus.ts \
  apps/server/src/wsServer.ts
git commit -m "feat(server): publish local plugin event stream"
```

## Task 4: Add the desktop bridge transport

**Files:**

- Create: `apps/desktop/src/localPluginBridge.ts`
- Create: `apps/desktop/src/localPluginBridge.test.ts`
- Create: `apps/desktop/src/localPluginBackendIpc.ts`
- Create: `apps/desktop/src/localPluginBackendIpc.test.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/main.test.ts`

**Step 1: Write the failing desktop bridge tests**

Create `apps/desktop/src/localPluginBridge.test.ts`.

Tests:

- listeners receive forwarded `LocalPluginEnvelope` payloads
- unsubscribe removes listener
- invalid payloads are ignored at the preload boundary
- backend child `message` events are attached and detached correctly
- a forwarded backend envelope reaches renderer windows through the actual desktop `message` listener path

**Step 2: Run test to verify it fails**

Run:

```bash
bun run test apps/desktop/src/localPluginBridge.test.ts
```

Expected:

- failure because the bridge module does not exist yet

**Step 3: Implement the desktop bridge helper**

Create `apps/desktop/src/localPluginBridge.ts`.

This should encapsulate:

- channel constant for local plugin events, for example `desktop:local-plugin-event`
- helper to broadcast an envelope to all renderer windows
- helper to register/unregister subscribers if needed internally

Keep the helper small. Avoid mixing this into browser tab or updater logic.

**Step 4: Wire the bridge in `main.ts`**

Modify `apps/desktop/src/main.ts`.

Follow the same general pattern already used for:

- `BROWSER_EVENT_CHANNEL`
- `UPDATE_STATE_CHANNEL`

Add:

- forwarding logic from the server-owned local plugin publisher stream into the Electron main process through child-process IPC
- forwarding logic from Electron main to all open windows:

```ts
window.webContents.send(LOCAL_PLUGIN_EVENT_CHANNEL, envelope);
```

The server process should publish once into the child IPC channel, and the desktop process should fan out from that channel to renderer windows.

Do not make the renderer responsible for subscribing to the server directly.

**Step 5: Expose the listener in `preload.ts`**

Modify `apps/desktop/src/preload.ts`.

Add to `DesktopBridge` exposure:

```ts
onLocalPluginEvent: (listener) => {
  const wrappedListener = (_event, payload) => {
    if (typeof payload !== "object" || payload === null) return;
    listener(payload as Parameters<typeof listener>[0]);
  };

  ipcRenderer.on(LOCAL_PLUGIN_EVENT_CHANNEL, wrappedListener);
  return () => {
    ipcRenderer.removeListener(LOCAL_PLUGIN_EVENT_CHANNEL, wrappedListener);
  };
},
```

**Step 6: Run tests to verify they pass**

Run:

```bash
bun run test apps/desktop/src/localPluginBridge.test.ts
bun run test apps/desktop/src/localPluginBackendIpc.test.ts
bun run test apps/server/src/main.test.ts -t "forwards local plugin envelopes to the parent process"
```

Expected:

- PASS

**Step 7: Commit**

```bash
git add apps/desktop/src/localPluginBridge.ts \
  apps/desktop/src/localPluginBridge.test.ts \
  apps/desktop/src/localPluginBackendIpc.ts \
  apps/desktop/src/localPluginBackendIpc.test.ts \
  apps/desktop/src/main.ts \
  apps/desktop/src/preload.ts \
  apps/server/src/main.ts \
  apps/server/src/main.test.ts
git commit -m "feat(desktop): expose local plugin event bridge"
```

## Task 5: Document OpenPeon consumption against the new bus

**Files:**

- Modify: `docs/plans/2026-03-23-openpeon-local-event-bus-design.md`
- Optionally create: `docs/plans/2026-03-23-openpeon-local-event-bus-adapter-example.md`

**Step 1: Write the documentation update**

Add a short concrete consumption section showing:

- how a desktop-local subscriber attaches to `onLocalPluginEvent`
- that Electron desktop currently receives server events through child-process IPC before rebroadcasting them to renderer subscribers
- how OpenPeon would map `turn.settled` results into CESP categories
- what v1 does not guarantee

Example adapter pseudo-code:

```ts
window.desktopBridge.onLocalPluginEvent((message) => {
  switch (message.event.kind) {
    case "session.started":
      sendToOpenPeon("session.start");
      break;
    case "turn.started":
      sendToOpenPeon("task.acknowledge");
      break;
    case "turn.settled":
      sendToOpenPeon(message.event.result === "completed" ? "task.complete" : "task.error");
      break;
  }
});
```

Keep this as documentation only. Do not check in adapter runtime code.

**Step 2: Run formatting**

Run:

```bash
bun fmt
```

Expected:

- formatting succeeds

**Step 3: Commit**

```bash
git add docs/plans/2026-03-23-openpeon-local-event-bus-design.md \
  docs/plans/2026-03-23-openpeon-local-event-bus-implementation-plan.md
git commit -m "docs: add openpeon local event bus implementation plan"
```

## Task 6: Full verification

**Files:**

- No new files

**Step 1: Run targeted tests**

Run:

```bash
bun run test packages/contracts/src/localPluginEvents.test.ts
bun run test apps/server/src/localPluginEventBus.test.ts
bun run test apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts
bun run test apps/desktop/src/localPluginBridge.test.ts
bun run test apps/desktop/src/main.test.ts
```

Expected:

- PASS

**Step 2: Run required repo checks**

Run:

```bash
bun fmt
bun lint
bun typecheck
```

Expected:

- `bun fmt` passes
- `bun lint` passes or only shows pre-existing warnings outside this change
- `bun typecheck` passes; if it fails for unrelated pre-existing reasons, capture them explicitly before claiming completion

**Step 3: Manual validation**

Run the desktop app and verify:

1. Start a session in a thread.
2. Observe one `session.started`.
3. Send a prompt and observe `turn.started`.
4. Let the turn finish successfully and observe one `turn.settled` with `result: "completed"`.
5. Trigger an approval-required command and observe one `approval.required`.
6. Trigger a user input prompt and observe one `user-input.required`.
7. Trigger a failing turn and observe one `turn.settled` with `result: "failed"` or one `runtime.error`, depending on path.
8. Reconnect/reload the desktop shell and verify historical events do not replay into fresh local alerts.

If you need a debugging tool, add temporary structured logging in the desktop main process and remove it before final commit.

**Step 4: Final commit**

```bash
git status
```

Expected:

- clean working tree

Then:

```bash
git commit -m "feat: add desktop local plugin event bus for external consumers"
```

Only do this if the work has not already been committed task-by-task.

## Open Questions To Resolve During Implementation

- Whether `resource.limit` can be emitted from an existing canonical runtime event immediately or should be deferred until a clearer signal is available.
- Whether the local event publisher should be introduced as a new Effect service tag or kept as a narrow local module until a second consumer exists.
- Whether `projectId` should be resolved at publish time in `ProviderRuntimeIngestion.ts` or omitted when not cheaply available.

Default answers for v1:

- defer speculative `resource.limit` emission if the signal is not clean
- use a small dedicated service if needed for clean wiring, otherwise keep the module narrow
- include `projectId` only when already available without extra queries

## Non-Negotiable Constraints

- No OpenPeon runtime code inside T3 Code
- No browser transport in v1
- No coupling to extension registry or UI slot work
- No raw provider event passthrough
- No event replay on first subscribe
- No completion sound equivalent for intermediate task lifecycle markers
