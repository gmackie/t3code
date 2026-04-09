# Extension Host Rationale And Domain Brainstorm

## Why An Extension Host Matters

T3 Code already has a strong shared substrate:

- thread + turn orchestration
- projected read models
- a typed WebSocket/event boundary
- a React shell that renders conversation, plans, and runtime state

What it does not currently have is a clean way for alternate product surfaces to grow on top of that substrate without becoming sweeping PRs or long-lived forks.

That matters because several ideas already want the same architectural thing:

- embedded preview/browser surfaces
- file/artifact explorers
- planning/requirements/task workflow surfaces

These are different features, but they all want the same core capability:

- a place to render domain-specific UI
- access to projected thread/project/artifact state
- a small set of safe host-owned capabilities
- a way to iterate outside core without forking the app

The argument for an extension host is not “plugins because plugins are cool.” It is:

> T3 Code should remain the shared substrate for agent-driven work, while extension seams allow more specialized interfaces to form on top of that substrate without fragmenting the ecosystem into isolated forks.

## Concrete Evidence From Existing T3 Code Work

### Browser / Preview Surface: `#37`, `#660`, `#963`

T3 Code already has demonstrated demand for preview-oriented UI:

- `#37` asks for an embedded browser
- `#660` asks for a Claude Code-style live preview
- `#963` is a substantial in-app browser implementation attempt

The key lesson from `#963` is not that browser preview must live in core. The lesson is that, without extension seams, a serious preview experiment has to become a large fork-sized change touching:

- chat shell UI
- right-panel state
- keybindings
- desktop bridge / IPC
- native browser runtime plumbing

With extension seams, most of that experimentation could live outside core. The sensitive runtime pieces would still remain core-owned.

### Explorer / Artifact Surface: `#763`

`#763` asks for file explorer and file preview support. This is an even better extension example because most of the value is UI:

- tree/explorer UX
- artifact viewers
- markdown/json/code preview
- changed-files or turn-oriented views

Core only needs to own the sensitive part:

- safe file read/list/open capabilities
- workspace boundary enforcement
- shell actions like “open in editor” or “open in file manager”

### Planning / Requirements / Task Workflows

Bob-style planning is the third proof point. T3 Code already has enough underlying state to support:

- plan review
- requirements extraction
- task draft generation
- workflow-specific artifact panels

But today those ideas either need to become core product bets or live in a fork. An extension host creates a middle path.

## Bounded Proposal

The safe proposal is still the same:

- experimental internal extension host
- frontend-first
- UI mount points
- read-only derived state
- host-owned capabilities
- no provider plugin marketplace
- no raw provider interception

This keeps T3 Code aligned with its current priorities:

- performance first
- reliability first
- predictable behavior under failure

## Why This Is Better Than Forks

Forks are expensive because they duplicate:

- shell integration work
- per-thread state handling
- event/read-model wiring
- UI maintenance against upstream changes

That makes ambitious workflow ideas hard to share, even when they are useful. Extension seams would lower the cost of experimentation while keeping the sensitive runtime boundaries centralized.

In other words:

- core owns the dangerous parts
- extensions own the exploratory UX

That is a healthier split than forcing all experimentation into either core PRs or full forks.

## Domain-Specific Extension Space

The near-term examples are easy to justify:

- browser / preview panels
- file / artifact explorers
- planning / requirements / task workflow surfaces

The longer-term opportunity is broader: domain-specific workspaces that still use T3 Code as the underlying conversation and orchestration base.

Examples:

- game development surfaces
- CAD / 3D review surfaces
- music / sound review surfaces
- asset generation tracking surfaces
- note-taking / knowledge-work surfaces
- business / legal / healthcare workflow surfaces

The point is not to turn T3 Code into all of those apps. The point is to let those workflows layer on top of the same substrate when that is more valuable than rebuilding an entire agent shell from scratch.

## Domain Map

### 1. Preview-Centric Domains

These need custom viewers and visual iteration loops.

Examples:

- web UI development
- game development
- 3D modeling review
- CAD review
- image generation review
- video review

Useful UI elements:

- preview panel
- tabbed artifact viewers
- version-to-version comparison
- issue pinning / annotation overlays
- “quote this region/selection into chat” workflows

Shared host capabilities:

- open preview surface
- open externally
- attach preview metadata to thread state

### 2. Artifact-Centric Domains

These center around files, generated outputs, and structured assets.

Examples:

- game assets
- 3D printing jobs
- manufacturing specs
- legal documents
- construction documents
- Etsy listing assets
- prompt output collections

Useful UI elements:

- artifact explorer
- filtered asset lists
- metadata panels
- status / generation history
- validation summaries
- export packaging views

Shared host capabilities:

- list artifacts
- read artifact metadata
- open in editor / file manager / external app

### 3. Workflow-Centric Domains

These need task flow and artifact progression more than visual preview.

Examples:

- planning and execution
- business operations
- legal drafting and review
- healthcare coordination
- construction planning
- manufacturing workflows

Useful UI elements:

- pipeline/status board
- requirements and brief panels
- task draft generation
- approval queues
- document bundles
- role-specific views over the same thread/artifact state

Shared host capabilities:

- export structured artifacts
- host-mediated workflow actions
- later, separate extension sessions

### 4. Knowledge-Centric Domains

These center around notes, connections, and evolving context.

Examples:

- Obsidian-like note-taking
- research
- personal knowledge bases
- project memory

Useful UI elements:

- note graph or backlink panel
- artifact-to-thread linking
- persistent concept cards
- summary / annotation sidebars

Shared host capabilities:

- save markdown artifacts
- link thread outputs to note objects
- surface derived references

## The Most Promising Domain-Specific UI Ideas

If this were prioritized for usefulness, the strongest early domains are:

1. web/game preview workflows
2. planning/requirements/task workflows
3. artifact explorer / document workflows
4. knowledge/note workflows

These fit the current T3 Code model best because they can start from:

- read-only thread/project state
- artifact rendering
- shell-owned actions

without demanding provider/runtime changes first.

## Non-Goals

This should not be framed as:

- a universal plugin marketplace
- arbitrary third-party provider execution
- an attempt to make T3 Code become every niche app
- a commitment to stable external APIs on day one

It should be framed as:

- an experimental extension host
- a safer place for UI and workflow experimentation
- a way to let useful ideas prove themselves before they become core
