# OpenPeon Local Event Bus Design

## Summary

T3 Code already models the hard part of notification-style integrations:

- provider runtime events are normalized into canonical runtime events
- runtime events are projected into orchestration state and thread activities
- turn lifecycle is guarded so child conversations and noisy intermediate events do not replace the user-visible turn

What T3 Code does not have yet is a stable local integration surface for external tools that want to react to those events on the user's machine.

This document proposes a desktop-first local event bus for external consumers such as OpenPeon. The bus is intentionally generic: OpenPeon is the motivating consumer, but the contract should be usable by future local plugins and automation tools without coupling T3 Code core to sound packs, desktop notification logic, or provider-specific hook semantics.

The first PR should only add:

- a versioned local event contract
- a desktop-hosted local transport
- reduction from existing orchestration/runtime state into a minimal set of local semantic events
- documentation for how OpenPeon would consume that stream

It should not add OpenPeon runtime code, pack management, audio playback, browser plugin hosting, or the separate UI extension architecture.

## Current Implementation Shape

The implemented path matches the proposed layering:

- `packages/contracts` defines the versioned `LocalPluginEnvelope` schema and the desktop preload listener surface
- `apps/server/src/localPluginEventBus.ts` reduces canonical runtime events into local semantic envelopes and publishes them through a scoped server bus
- `apps/server/src/main.ts` forwards those envelopes to the Electron parent process through child-process IPC when `process.send` is available
- `apps/desktop/src/localPluginBridge.ts` decodes forwarded envelopes and rebroadcasts them to renderer windows
- `apps/desktop/src/localPluginBackendIpc.ts` owns the narrow child `message` subscription seam so the desktop transport is testable without depending on the full Electron main runtime in tests

That keeps OpenPeon out of core while still giving desktop-local consumers a concrete transport to attach to.

## Problem Statement

There are two closely related user needs:

1. T3 Code should surface important local lifecycle changes such as completed turns and approval-required states.
2. Tools like OpenPeon should be able to consume those lifecycle changes without T3 Code having to own the notification stack itself.

Issue [#376](https://github.com/pingdotgg/t3code/issues/376) captures the right framing: the missing piece is not more raw event modeling, but a clean local bridge for external notification and automation tools. Issue [#780](https://github.com/pingdotgg/t3code/issues/780) captures the narrower product need for completion and approval notifications.

The design constraint is important:

- notification and sound delivery should happen on the user's local machine
- the server process may be remote or logically separate from the user's desktop
- external consumers should not need to understand raw provider protocol details to infer settled state

## Goals

### Primary goals

- Expose a stable local event stream that external local consumers can subscribe to.
- Derive local events from user-visible lifecycle state, not raw provider protocol noise.
- Keep the first transport desktop-first so the integration runs on the user's machine.
- Make OpenPeon integration straightforward and similar in spirit to its existing host adapters.
- Preserve a path for later non-OpenPeon local consumers without entangling this work with the UI plugin architecture.

### Non-goals for the first PR

- Shipping OpenPeon itself inside T3 Code
- Sound playback, pack selection, pack installation, or CESP runtime logic inside T3 Code
- Browser-hosted consumers
- Bidirectional plugin APIs
- Generic plugin discovery, installation, or registry work
- Server-side webhook or shell hook execution as the main integration model
- Provider-specific raw notification passthrough

## Why This Should Be a Generic Bus

OpenPeon's existing integrations fall into two broad shapes:

- thin adapters around an existing host hook surface, such as Codex `notify`
- native integrations that subscribe to a host's local runtime events, such as the OpenCode plugin

T3 Code should support the second model.

The host should provide one generic local event stream and let OpenPeon map those events into CESP categories on its side. That keeps T3 Code focused on local lifecycle semantics while OpenPeon continues to own:

- CESP mapping policy
- sound pack lookup
- no-repeat logic
- debounce behavior
- desktop notification styling
- pack-specific titles, icons, and audio playback

This also gives T3 Code a clean future seam for local-only consumers beyond OpenPeon, without pulling the separate UI extension work into this PR.

## Recommended Architecture

Use a three-layer model.

### Layer 1: Existing runtime and orchestration state remain the source material

The current runtime stack already normalizes provider behavior into events such as:

- `session.started`
- `turn.started`
- `turn.completed`
- `request.opened`
- `user-input.requested`
- `runtime.warning`
- `runtime.error`

That logic should continue to live where it already lives today. Do not expose raw provider notifications as the public local contract.

### Layer 2: Add a reduced local semantic event contract

Introduce a new contracts-level schema for local plugin events. This should be narrower than provider runtime events and explicitly user-visible in meaning.

The contract should be versioned from day one and stable enough for external local consumers.

### Layer 3: Desktop hosts the first transport

The Electron desktop runtime should host the first bus transport and publish local plugin events to subscribers on the user's machine.

This keeps the first implementation:

- local
- desktop-safe
- independent of browser notification permission behavior
- separate from the web UI plugin work

The contract should still be transport-agnostic so a browser consumer can attach later without changing event semantics.

## Where Event Reduction Should Happen

Event reduction should happen inside T3 Code after provider/runtime normalization and after lifecycle guarding, not inside OpenPeon.

That is the most important design choice in this proposal.

OpenPeon should not have to infer:

- whether a `turn.completed` is the real user-visible completion signal
- whether a child conversation event should be ignored
- whether reconnect replay should be suppressed
- whether an intermediate task marker is final

T3 Code already owns those semantics. The local bus should expose only the reduced result.

## Event Contract

## Envelope

Every message should be wrapped in a versioned envelope.

Suggested shape:

```ts
type LocalPluginEnvelope = {
  type: "event";
  version: 1;
  sequence: number;
  event: LocalPluginEvent;
};
```

The `sequence` field gives consumers a stable monotonic ordering per local bus instance.

## Event Types

The first version should stay intentionally small.

```ts
type LocalPluginEvent =
  | SessionStartedEvent
  | TurnStartedEvent
  | TurnSettledEvent
  | ApprovalRequiredEvent
  | UserInputRequiredEvent
  | RuntimeErrorEvent
  | ResourceLimitEvent;
```

### `session.started`

Emitted when a local session becomes available and user-visible for a thread.

Purpose:

- session greeting sounds
- local session metadata initialization

### `turn.started`

Emitted when the active user-visible turn starts.

Purpose:

- map to `task.acknowledge`
- allow local consumers to mark work as in progress

### `turn.settled`

Emitted when the active user-visible turn is truly settled.

This is the key event in the whole design.

Suggested payload fields:

- `result`: `completed | failed | interrupted | cancelled`
- `summary`: short best-effort summary if available
- `errorMessage`: populated for failed turns when useful

This event must only be emitted once for the user-visible turn settlement. It must not be driven by intermediate `task.completed` events or child conversation noise.

### `approval.required`

Emitted when a provider approval request that requires user action becomes open.

Suggested payload fields:

- `requestId`
- `requestKind`: `command | file-read | file-change | unknown`
- `detail`

### `user-input.required`

Emitted when non-approval user input is requested.

Suggested payload fields:

- `requestId`
- `questions`

### `runtime.error`

Emitted for true runtime-level errors that should alert the user.

This is separate from `turn.settled: failed` because the runtime may error independently of a normal turn lifecycle.

### `resource.limit`

Emitted when T3 Code can confidently determine the user hit a rate, token, quota, or similar limit.

This should be driven from canonical limit/rate events, not guessed from arbitrary warning text when avoidable.

## Common Metadata

Every local event should include a common base:

```ts
type LocalPluginEventBase = {
  id: string;
  kind: string;
  createdAt: string;
  provider: "codex" | "claudeAgent";
  threadId: string;
  projectId?: string;
  turnId?: string;
  summary?: string;
  detail?: Record<string, unknown>;
};
```

This is enough context for OpenPeon titles/messages and useful for future local consumers without leaking raw provider payloads.

## OpenPeon Mapping

OpenPeon should consume the bus by mapping local semantic events into CESP categories.

Recommended mapping:

- `session.started` -> `session.start`
- `turn.started` -> `task.acknowledge`
- `turn.settled` with `result: completed` -> `task.complete`
- `turn.settled` with `result: failed | interrupted | cancelled` -> `task.error`
- `approval.required` -> `input.required`
- `user-input.required` -> `input.required`
- `runtime.error` -> `task.error`
- `resource.limit` -> `resource.limit`

This keeps T3 Code out of pack logic while giving OpenPeon a very small adapter surface.

## Transport

The first version should use a read-only local subscriber transport hosted by the desktop app.

Recommended transport:

- local loopback WebSocket or equivalent local streaming socket

Requirements:

- local-only binding
- read-only
- streaming-friendly
- low ceremony for consumers
- simple to test

Why not per-event hook commands:

- harder to generalize into future local consumers
- process spawn overhead on every event
- quoting and env portability problems
- weaker fit for a persistent local integration model

Why not server-side hooks:

- wrong execution location for local notification tooling
- complicates remote-server setups
- encourages consumers to depend on server locality instead of user locality

## Delivery Semantics

The bus should make a few guarantees explicit.

### Guaranteed

- best-effort ordered delivery within one bus instance via `sequence`
- events are semantic and already reduced from raw provider/runtime state
- no replay of historical events on initial subscribe unless explicitly added in a future version

### Not guaranteed

- durable offline delivery
- exactly-once delivery across desktop restarts
- cross-device fanout

That is acceptable for OpenPeon-style local notifications. The consumer should treat the stream as live, local, and ephemeral.

## Dedupe and Noise Suppression Rules

The first version should be strict here.

### Required suppression

- child conversation lifecycle events that are already suppressed from replacing the parent turn
- duplicate turn settlement caused by reconnect or snapshot refresh
- intermediate task lifecycle events that do not represent final user-visible completion
- duplicate approval or user-input alerts when the same request remains open across refresh

### Required preference

- prefer post-orchestration settled state over raw provider event timing
- prefer one high-signal event over several noisy ones

This is the difference between a usable OpenPeon bridge and an annoying one.

## Desktop-First, Transport-Agnostic

The first implementation should be desktop-only, but the contract should not assume Electron-specific semantics.

That matters for two reasons:

1. The design should not need to change if the browser app gets a local consumer later.
2. This event bus is likely to become useful for future local plugin consumers outside OpenPeon.

The right compromise is:

- desktop hosts the first transport
- contracts remain generic
- browser support is explicitly deferred

That keeps the PR acceptable in size while giving a defensible reason for the abstraction.

## Relationship to the Separate UI Plugin Work

This proposal should stay separate from the runtime-discoverable extension host work.

The UI extension work is about:

- rendering external UI in host-owned slots
- manifests
- capabilities
- registry/discovery

This proposal is about:

- local event publication
- desktop-side consumers
- external local automation/notification tools

The overlap is architectural direction, not implementation scope. Both want explicit host-owned seams, but they should not be coupled in the first PR.

## Proposed File/Module Direction

Exact filenames can change, but the likely landing zones are:

- `packages/contracts`
  - add `LocalPluginEvent` schemas and types
- `apps/server`
  - add a reducer that derives local semantic events from runtime/orchestration state
  - or add a small dedicated service that subscribes to the relevant internal event stream
- `apps/desktop`
  - host the local transport and publish envelopes to subscribers
- `docs/plans`
  - document the public contract and OpenPeon mapping

If the reducer can cleanly live near orchestration/runtime ingestion, that is preferable to rebuilding semantics in the desktop app.

## Risks

### 1. Emitting too early from raw runtime signals

If the bus emits directly from provider events, completion sounds will be noisy or wrong.

Mitigation:

- emit from reduced lifecycle state only
- make `turn.settled` a first-class semantic event

### 2. Over-designing for future plugins

It would be easy to accidentally turn this into a generic plugin platform PR.

Mitigation:

- keep transport read-only
- no plugin loader
- no registry/discovery
- no browser implementation

### 3. Under-specifying replay and dedupe

If startup/reconnect behavior is not explicit, consumers will guess incorrectly.

Mitigation:

- document that the bus is live and non-replaying in v1
- ensure dedupe happens before publish

### 4. OpenPeon-specific leakage into core

If event names or fields are shaped like CESP instead of T3 Code semantics, the abstraction will be too narrow.

Mitigation:

- keep T3 Code event names local and semantic
- document OpenPeon mapping separately

## Recommended First PR Scope

The first PR should include:

1. `LocalPluginEvent` contract in `packages/contracts`
2. Desktop-hosted local bus transport
3. Emission for the minimal event set:
   - `session.started`
   - `turn.started`
   - `turn.settled`
   - `approval.required`
   - `user-input.required`
   - `runtime.error`
   - `resource.limit`
4. Tests for lifecycle mapping and dedupe
5. Documentation showing how an OpenPeon adapter would subscribe and map events

The first PR should not include:

- OpenPeon runtime integration code
- browser transport
- settings UI
- sounds
- desktop notifications
- UI plugin architecture changes

## Acceptance Criteria

This work is successful if:

- a local consumer can subscribe from the desktop machine and receive a small semantic event stream
- `turn.settled` only fires for true user-visible completion/failure/interruption
- approval and user-input events do not replay noisily on reconnect
- the contract is generic enough that OpenPeon is clearly just one consumer
- the PR remains independent from the separate UI plugin work

## Follow-Up Work

Likely follow-up steps after the first PR:

1. Build a tiny OpenPeon adapter outside T3 Code that subscribes to the bus and maps events into CESP.
2. Validate the bus against real Codex and ClaudeAgent sessions, especially long-running turns, child conversations, and reconnect paths.
3. Decide later whether the browser app should host a local consumer path using the same contract.
4. Decide later whether other local plugins should consume this stream for automation or assistive tooling.

## Recommendation

Proceed with a desktop-first, read-only, versioned local event bus whose first documented consumer is OpenPeon.

Do not implement OpenPeon inside T3 Code. Do not couple this PR to the separate UI plugin architecture. Keep the contract semantic, minimal, and based on true user-visible lifecycle state rather than raw provider notifications.
