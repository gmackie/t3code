# Multi-Agent UI + Bob Compatibility Design

**Date:** 2026-03-26  
**Status:** Draft  
**Scope:** Multi-agent orchestration UI in T3 Code, Bob backend/front-end compatibility, canonical orchestration event model

## Summary

This document defines a shared direction for three related efforts:

1. Build a multi-agent orchestration UI in T3 Code.
2. Align Bob toward T3 Code's orchestration model as much as possible in v1.
3. Shape the event model so it stays compatible with broader agent ecosystem convergence, including OpenPeon-aligned concepts, without waiting for a universal standard to emerge.

The key decision is to treat **T3 Code as the v1 reference orchestration model**. Bob should adapt toward that model by default, unless a T3 Code boundary is genuinely blocking required Bob functionality. At the same time, the event vocabulary should be reviewed against OpenPeon and adjacent agent-runtime conventions so the model remains ecosystem-neutral and can evolve into a stronger shared standard in v2.

This is not a full-stack merger. In v1, Bob and T3 Code keep their native APIs and product models. Compatibility is established at the **orchestration host model** and **canonical event stream** layers.

## Goals

### Primary goals

- Add a first-class multi-agent orchestration UI to T3 Code.
- Make Bob capable of powering T3 Code-style orchestration views.
- Define a canonical orchestration read model that both products can project into.
- Define a canonical orchestration event taxonomy that Bob can emit in v1.
- Preserve Bob's work-item-first product model and T3 Code's thread-first interaction model.
- Leave room for later convergence toward a shared backend contract in v2.

### Non-goals for v1

- Force Bob and T3 Code to share a raw transport protocol or one backend API.
- Replace Bob's native work-item/task-run model.
- Replace T3 Code's existing thread/session model.
- Finalize an ecosystem-wide universal agent standard.
- Build a third standalone platform that sits above both products.

## Core Direction

### 1. T3 Code is the v1 reference shape

T3 Code already has the stronger orchestration-oriented frontend direction:

- thread/session-centric UX
- orchestration domain events
- extension-host direction
- plan and side-panel overlays
- provider/runtime abstraction

For v1, these concepts should anchor the shared model. Bob should align toward them where practical.

### 2. Bob keeps native APIs in v1

Bob should not be forced into a premature backend rewrite. Its native APIs, product routes, work-item model, task-run model, and lifecycle persistence can remain Bob-native in v1.

Instead, Bob adds:

- a **canonical orchestration projection layer**
- a **T3 Code-shaped orchestration event stream**
- a **frontend host-model adapter** for any T3 Code-compatible UI surfaces

### 3. OpenPeon is a semantic cross-check

OpenPeon should be treated as both:

- a likely future consumer of similar orchestration semantics
- a pressure source that helps keep event vocabulary ecosystem-neutral

But OpenPeon should not be the authority for the v1 contract. The immediate v1 contract is T3 Code-shaped. OpenPeon compatibility matters at the semantic layer, especially for:

- multi-agent delegation
- waits and blockers
- task ownership
- artifacts
- approvals and structured user input
- run and agent lifecycle

## Shared Canonical Model

The shared model should sit below both products' native UX models.

### Canonical entities

- `session`
  One conversational execution context. In T3 Code this typically maps to a thread-backed provider session. In Bob this typically maps to a gateway or chat session.

- `run`
  An orchestration container attached to a root session/thread. A run exists when a conversation becomes operationally multi-step or multi-agent. Planning and execution can both use the same run model.

- `agent`
  A runtime worker instance participating in a run. An agent usually has a backing session/thread but remains a distinct orchestration object.

- `task`
  An explicit unit of work assigned to or owned by an agent. Tasks are first-class in v1 to allow exploration of task semantics without hiding them inside generic state blobs.

- `artifact`
  A durable output of a run, agent, or task. Examples: markdown plans, code diffs, patches, checkpoints, PRs, review summaries, files, links.

- `linkedEntity`
  A typed external reference linking orchestration objects to product-native objects. Examples: Bob work items, Bob dispatch batches, Bob task runs, T3 Code threads, repositories, pull requests, commits.

- `lifecycleEvent`
  A canonical event describing a meaningful orchestration state change.

### Product-specific projection

T3 Code and Bob should project the canonical entities differently.

#### T3 Code projection

- primary frame: thread/session
- `run` is an optional overlay attached to a root thread
- child agents often map to child threads
- linked Bob-specific entities appear as external metadata only when present

#### Bob projection

- primary frame: work item / planning pipeline / execution board
- work items remain the main product object
- runs, sessions, and agents appear as execution surfaces attached to work items
- work-item detail pages can render canonical orchestration views inside Bob-native chrome

## Multi-Agent UI Model in T3 Code

### Root model

The root user object remains a normal thread. When delegation or multi-step orchestration begins, that thread gains an attached `run` overlay.

This avoids replacing T3 Code's thread-centric mental model while still enabling a richer operator experience.

### Run overlay

The run overlay is host-owned and extension-rendered. It is not a separate top-level application mode in v1.

The root thread remains canonical for:

- user conversation
- assistant narrative
- approvals and replies
- default navigation

The run overlay becomes canonical for:

- worker visibility
- branch and child-agent monitoring
- orchestration status
- task assignment and blockers
- artifacts and results

### First-class graph view

The graph view is a core projection, not an afterthought.

#### Initial graph shape

For v1, the graph renders **agent/thread nodes only**.

Each node represents:

- a real agent instance
- usually a backing session/thread
- runtime state
- capability/profile summary
- compact task summary

Task objects are still first-class in the data model, but task detail stays nested in node summaries and the node inspector rather than being rendered as independent graph nodes in v1.

#### Graph modes

The graph supports two synchronized modes over the same underlying run model:

- `Map`
  Structural mode. Stable layout, low motion, optimized for comprehension.

- `Live`
  Operational mode. Highlights active, blocked, failed, and waiting nodes and recent activity.

### Node inspector

Selecting an agent node opens a richer inspector view.

The inspector should show:

- agent identity
- role label
- description
- directives
- skills
- tool access
- model/provider
- sandbox / approval posture
- backing thread/session link
- current task summary
- recent tasks
- latest artifacts
- waits, blockers, pending approvals, pending user input

### Extension-host surfaces

The orchestration UI should be built through the extension-host slot model instead of hardcoding more panel logic into core layout files.

Recommended initial slots:

- `thread.sidePanel`
  Run graph and selected-agent inspector

- `thread.header.actions`
  Open/focus run view, graph mode toggle, filters

- `chat.timeline.item.after`
  Inline orchestration markers for spawn, wait, handoff, completed child work, and artifact creation

- `threads.sidebar.section`
  Optional roll-up of active runs or blocked workers

## Compatibility Strategy

## v1 rule

Bob aligns toward T3 Code.

That means:

- Bob backend emits a more T3 Code-shaped orchestration event stream in v1.
- Bob frontend can project into the same orchestration host model used by T3 Code UI extensions.
- T3 Code should only change to accommodate Bob when a T3 Code boundary is truly blocking required features.

This avoids creating a vague third abstraction while still leaving room for later convergence.

## Native API policy

In v1:

- T3 Code keeps native APIs.
- Bob keeps native APIs.
- compatibility is achieved through projection layers and canonical events

In v2:

- if the canonical orchestration read model proves stable, both backends can align around a stronger shared backend contract

## Canonical Event Taxonomy

The canonical orchestration stream should use neutral names and avoid product-specific assumptions.

### Thread/message events

- `thread.message.started`
- `thread.message.delta`
- `thread.message.completed`
- `thread.message.failed`

Purpose:

- capture assistant output progression
- preserve compatibility with T3 Code chat rendering
- support Bob session/chat rendering where needed

### Run events

- `run.started`
- `run.updated`
- `run.completed`
- `run.failed`

Purpose:

- represent creation and lifecycle of orchestration overlays
- describe run-level state transitions independent of any one thread or work item

### Agent events

- `agent.spawned`
- `agent.updated`
- `agent.completed`
- `agent.failed`

Purpose:

- model worker creation and runtime state changes
- link agent instances to sessions/threads
- support graph-node creation and monitoring

### Agent-task events

Tasks are first-class in v1.

- `agent.task.assigned`
- `agent.task.progressed`
- `agent.task.blocked`
- `agent.task.completed`
- `agent.task.failed`
- `agent.task.reassigned`

Purpose:

- make task semantics explicit early
- support exploration of task modeling without burying meaning in generic `agent.updated` payloads
- support graph node summaries and inspector details
- align with Bob's planning/dispatch/task-run worldview while remaining usable in T3 Code

### Request and interaction events

- `request.opened`
- `request.resolved`
- `user_input.requested`
- `user_input.resolved`

Purpose:

- approvals
- file/command requests
- structured user input
- wait states that impact orchestration

These map naturally to T3 Code's current approval/user-input handling and remain broadly compatible with agent ecosystems that distinguish permission and input waits.

### Artifact events

- `artifact.produced`
- `artifact.updated`
- `artifact.promoted`

Purpose:

- markdown plans
- files
- diffs
- checkpoints
- PRs
- review outputs
- commits

### Link events

- `link.created`

Purpose:

- attach runtime objects to product-native entities
- examples:
  - run -> Bob work item
  - run -> T3 Code root thread
  - agent -> thread
  - artifact -> work item
  - artifact -> PR

Additional link operations can be added later if needed, but `link.created` is sufficient for v1 exploration.

## Required Canonical Payload Shape

The exact schema can evolve, but each canonical event should carry a stable minimum envelope.

### Shared envelope

Every event should include:

- `eventId`
- `type`
- `createdAt`
- `runId`
- optional `threadId`
- optional `agentId`
- optional `taskId`
- optional `artifactId`
- optional `linkedEntityRefs`
- `payload`

### Identity rules

- `runId` is required for orchestration events.
- `threadId` is present when an event is tied to a session/thread.
- `agentId` is present for agent-scoped events.
- `taskId` is present for explicit task events.
- `artifactId` is present for artifact events.

This keeps the stream flexible enough to support multiple products without losing stable lookup keys for UI reconciliation.

## Bob-to-Canonical Mapping

Bob should keep native internals but emit canonical projections.

### Object mapping

- `Bob work item`
  Maps to `linkedEntity(kind: "workItem")`

- `Bob taskRun`
  Usually maps to canonical `run`

- `Bob child taskRun`
  Can map to either child `run` or a child-run-backed `agent` depending on the level of orchestration

- `Bob session / gateway session`
  Maps to canonical `session` and usually provides the `threadId`-like backing surface

- `Bob managed agent`
  Maps to canonical `agent`

- `Bob lifecycle event`
  Maps to canonical orchestration event, not just timeline decoration

- `Bob dispatch batch / dependency info`
  Maps to linked entities and task-blocking relationships

### Planning and execution alignment

Planning and execution should use the same canonical model in v1.

That means:

- planning sessions can create `run`, `agent`, `task`, and `artifact` objects
- execution sessions can do the same
- the distinction between planning and execution is modeled through metadata and event payloads, not by inventing separate orchestration object types

This keeps the UI simpler and reduces the number of special cases.

## T3 Code-to-Canonical Mapping

T3 Code is already close to the desired model.

Likely mapping:

- T3 Code root thread -> canonical root session/thread
- T3 Code provider session -> canonical session runtime state
- T3 Code orchestration thread overlay -> canonical run
- T3 Code delegated child thread -> canonical agent + linked thread
- T3 Code approvals/user input -> canonical request and user-input events
- T3 Code proposed plans/checkpoints/diffs -> canonical artifacts

The main area T3 Code needs to grow is explicit multi-agent graph/run modeling, not basic event projection.

## OpenPeon Alignment

OpenPeon should influence the naming and semantics of the canonical stream, but not replace the T3 Code reference shape in v1.

### Guidance

- prefer ecosystem-neutral names
- make delegation explicit
- make waits explicit
- make artifacts explicit
- keep session, run, and task separate
- avoid assuming one product's top-level object is universal

### Practical rule

If OpenPeon-aligned semantics reveal a meaningful gap in the T3 Code-shaped event model, that is a valid reason to evolve the canonical taxonomy even during v1.

## UI Reuse Strategy

The multi-agent graph and inspector should be implemented against a **host read model**, not directly against T3 Code stores or Bob tables.

### Host read model responsibilities

- provide run graph data
- provide selected thread/session context
- provide agent profile and runtime summaries
- provide artifact summaries
- provide linked-entity references
- expose host actions in a capability-controlled way

### Example host actions

- focus thread
- open linked work item
- open artifact
- request workspace write
- acknowledge input request
- resolve approval

This allows:

- T3 Code frontend using T3 Code backend
- T3 Code frontend using Bob backend projection
- Bob frontend embedding or reusing T3 Code-style orchestration UI

## Suggested Phases

### Phase 1: Canonical modeling

- define canonical run/agent/task/artifact/link concepts
- define canonical event taxonomy
- define Bob projection strategy

### Phase 2: Bob backend projection

- expand Bob gateway/execution stream to emit T3 Code-shaped orchestration events
- emit explicit run, agent, task, request, artifact, and link events

### Phase 3: T3 Code orchestration UI

- add run overlay model
- build graph + inspector through extension-host slots
- add root-thread orchestration timeline markers

### Phase 4: Bob-compatible frontend projection

- adapt Bob-native data into the host read model
- render T3 Code-style orchestration views inside Bob-native surfaces

### Phase 5: v2 alignment

- evaluate convergence on stronger shared backend contracts
- revisit raw API alignment
- revisit OpenPeon-aligned ecosystem standards

## Risks

### Risk: premature standardization

Trying to standardize every backend/API shape now would slow feature work and likely create the wrong abstraction.

Mitigation:

- align at the host model and event stream first
- keep native APIs in v1

### Risk: too much Bob-specific leakage into the canonical model

If work-item or task-run specifics leak into the canonical model, T3 Code compatibility will degrade.

Mitigation:

- keep work items as linked entities
- keep canonical runtime objects neutral

### Risk: task model churn

The task model is still exploratory.

Mitigation:

- make task events first-class now
- keep payload requirements minimal
- let the UI consume summaries before task-node rendering is introduced

### Risk: graph UX overload

A graph UI can become noisy and fragile if too much detail is visualized at once.

Mitigation:

- v1 graph uses agent/thread nodes only
- tasks stay nested in node summaries and inspector
- separate `Map` and `Live` projections

## Decisions

- T3 Code is the v1 reference orchestration model.
- Bob aligns toward T3 Code unless T3 Code blocks required functionality.
- Bob keeps native APIs in v1.
- Bob backend should emit a more T3 Code-shaped orchestration event stream in v1.
- OpenPeon is a semantic cross-check and future alignment pressure, not the primary v1 contract.
- Planning and execution use the same canonical `run / agent / task / artifact / linkedEntity` model in v1.
- The T3 Code multi-agent UI is an agent-centric run overlay attached to a root thread.
- The primary v1 visualization is a graph of agent/thread nodes only.
- Task details remain nested in node summaries and inspector in v1.
- `agent.task.*` events are first-class in v1 to allow task-model exploration.

## Open Questions

- Which existing T3 Code event types should be preserved verbatim vs superseded by the new canonical taxonomy?
- Should child Bob task runs always become child canonical runs, or only when they represent durable sub-work rather than ephemeral delegation?
- Which canonical event payload fields should be mandatory in the first implementation pass?
- How much of the graph and inspector should live in one extension package vs multiple slot-specific extensions?
