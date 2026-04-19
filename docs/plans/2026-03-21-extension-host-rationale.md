# Why an Extension Host — and Why Now

## The Problem This Solves

T3 Code has a growing number of contributors who want to add side panels, tools, and workflow-specific UI. Today, each new panel requires modifying core layout files (`_chat.$threadId.tsx`, `ChatView.tsx`, state stores), getting consensus from maintainers, and shipping in a monolithic PR. This creates two failure modes:

1. **The contributor gives up.** The friction of touching core layout code, understanding the panel lifecycle, and getting approval on a large cross-cutting diff kills ideas before they ship. PR #963 (in-app browser) is 3200+ lines across 22 files — a heroic effort, but not a pattern that scales to 10 contributors with 10 different ideas.

2. **The maintainers say no.** Every new panel in the core layout is a permanent maintenance burden. Saying "yes" to a browser panel means saying "yes" to maintaining it forever. The natural response is conservatism — which is rational for maintainers but stifles innovation.

The extension host resolves both by **changing the cost structure**: a new panel is one file + one registry entry, not a cross-cutting layout change.

## What the Extension Host Actually Is

It's 400 lines of infrastructure that provides:

- **A stable API surface** (`T3ExtensionDefinition`) — extensions implement `isAvailable` and `render`, receive `ExtensionContext` with read-only thread/project state
- **A panel host** (`ExtensionHost` + `ExtensionSidePanel`) — manages tab switching, availability filtering, and panel chrome
- **A selector layer** (`extensionSelectors`) — maps internal app state to the extension-safe read model
- **A registry** (`builtinRegistry`) — static array of registered extensions

That's it. No plugin marketplace, no dynamic loading, no sandboxing, no provider interception. It's the smallest possible thing that makes adding panels trivial.

## Anticipated Objections and Responses

### "This is premature abstraction. We only have 4 panels."

The abstraction already exists — it's just distributed across `_chat.$threadId.tsx` in ad hoc form. The route file manages diff panel visibility, browser panel visibility, plan sidebar visibility, and extension panel visibility through separate state variables, separate toggle callbacks, and separate mutual-exclusivity logic. The extension host centralizes what's already happening.

The cost of the abstraction (400 lines, 0 new dependencies) is already paid back. Without it, PR #963's browser panel required 700+ lines of changes to the chat route alone. With it, the browser extension is 270 lines in a single file with zero route changes.

**Metric:** Adding the 5th panel type without the extension host would require ~200 lines of route/ChatView changes. With the extension host: ~1 line in `builtinRegistry.ts` + the component file.

### "Extensions should use the existing side panel patterns (like PlanSidebar)."

PlanSidebar is hardcoded into `ChatView.tsx`. To add a second sidebar-style panel, you'd copy PlanSidebar's open/close state management, add a new toggle to the header, add mutual-exclusivity logic with the existing panels, handle responsive behavior, and wire up the new state. That's ~150 lines of layout plumbing per panel.

The extension host does this plumbing once. Every subsequent panel inherits it for free.

### "The separate-package pattern is over-engineering."

Today, yes. The packages are proof-of-concept. The point is demonstrating that the extension API contract (`@t3tools/extension-api`) is clean enough that a planning workbench or browser panel could live in its own repo without depending on the web app's internals.

This matters for two reasons:

1. **Contributors can prototype extensions without forking the whole app.** They depend on `@t3tools/extension-api`, build their component, and register it. No need to understand the orchestration layer, the WebSocket transport, or the Zustand store.
2. **Maintainers can accept or reject extensions independently.** A planning workbench can ship without blocking a browser panel. Extensions don't couple to each other.

### "This doesn't actually solve the browser panel problem. PR #963 still needs deep integration."

Correct — and that's the key insight. The browser panel has two layers:

1. **Infrastructure** (WebContentsView management, IPC channels, bounds sync, tab LRU) — this is inherently coupled to the desktop app and can't be an extension.
2. **UI surface** (BrowserPanel component, tab strip, nav bar, address bar) — this is a pure React component that can be rendered by an extension.

The extension host handles layer 2. Layer 1 stays in `apps/desktop/src/browserManager.ts` where it belongs. The extension wraps the UI component and connects it to the infrastructure through the existing IPC contracts. This separation means the browser UI can evolve independently of the browser runtime.

### "Why not use React slots / composition instead?"

React composition (render props, context providers, portal-based slots) can solve the panel rendering problem. But it doesn't solve:

- **Discovery:** How does the app know which panels are available? The registry.
- **Availability:** How does a panel conditionally appear based on thread state? `isAvailable(context)`.
- **Ordering:** How are panels ordered in the tab bar? The `order` field.
- **Lifecycle:** How does the host manage open/close, active tab, and responsive behavior? The host component.

These are the problems that turn "render a component in a slot" into "manage a set of dynamically-available panels." The extension host is composition + management.

### "The extension context is a leaky abstraction. Extensions bypass it to call readNativeApi()."

True for built-in extensions. The `ExtensionContext` provides read-only state. Side effects (clipboard, file writes, browser IPC) go through `readNativeApi()` directly, following the PlanSidebar precedent.

For a future where extensions are external, the context could be extended with approved action methods (`context.actions`). The current `HostWorkflowAction` interface is already there — it just has no implementations yet. This is intentional: add actions when there's a real need, not speculatively.

### "This adds maintenance burden to the core team."

The extension host itself is 400 lines with 12 tests. It has no external dependencies. It touches exactly one core file (`ChatView.tsx` — 30 lines of wiring). If it's abandoned, removing it is a one-commit revert.

The maintenance cost of NOT having it is higher: every new panel idea requires core team involvement in layout code, mutual-exclusivity logic, and responsive behavior. The extension host delegates that complexity to the host once, and panel authors never think about it.

## What This Enables

### Short-term (shipped in this branch)

- **Planning workbench** — structured requirements extraction, task drafts, workspace export. Independent of the browser panel or any other extension.
- **Preview workspace** — project-aware dev server preview. Uses browser infrastructure from PR #963 but is a separate extension that can evolve independently.
- **Browser panel as extension** — demonstrates that PR #963's browser can be a pluggable panel rather than a hardcoded route feature.
- **Thread overview** — diagnostic extension showing thread signals.

### Medium-term (with the extension API package)

- Contributors prototype extensions against `@t3tools/extension-api` without touching core code
- Extensions can be reviewed and accepted independently (no blocking between unrelated panels)
- Community extensions: terminal panel, documentation viewer, test runner, deployment status

### Long-term (with external extension loading)

- Extension marketplace (optional, deferred)
- Per-user extension selection (some users want planning tools, others want browser tools)
- Extension-specific settings and state

## The Core Argument

**The extension host shifts the cost of innovation from the core team to the contributor.** Without it, adding a new panel requires the core team's time, attention, and approval on a cross-cutting layout change. With it, adding a new panel requires one file and one line in a registry.

This doesn't remove quality control — the registry is still in the main repo, extensions still go through code review. But it moves the review question from "should we restructure our layout to support this?" to "does this extension do what it claims?" That's a much faster review.

In a project with limited core team bandwidth and growing contributor interest, that cost shift is the difference between 2 new panels per quarter and 10.
