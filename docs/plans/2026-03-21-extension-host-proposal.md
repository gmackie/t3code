# Extension Host Proposal for T3 Code

## Executive Summary

We propose adding an experimental extension host to T3 Code — a lightweight system (~400 lines) that lets contributors add new side panels (planning tools, browser, preview, diagnostics) by writing a single component and registering it, with zero changes to core layout code.

This proposal is demonstrated with four working extensions, a shared API contract package, and a concrete example of how PR #963's in-app browser panel can be refactored from a hardcoded layout feature to a pluggable extension.

## The Problem

T3 Code's contributor community is growing, and contributors want to add workflow-specific UI: planning workbenches, browser panels, preview tools, documentation viewers, terminal integrations. Today, each new panel requires:

1. **Modifying core layout files** — `_chat.$threadId.tsx` (700+ lines of panel management), `ChatView.tsx` (4000+ lines, already the largest component)
2. **Adding panel-specific state stores** — each panel needs its own visibility state, per-thread persistence, and mutual-exclusivity logic with other panels
3. **Getting maintainer buy-in on a large diff** — because the changes are cross-cutting, every panel PR touches the same critical files

This creates a bottleneck. PR #963 (in-app browser) is an excellent contribution — 3200+ lines across 22 files — but it's not a pattern that scales. The 5th contributor who wants to add a terminal panel or a documentation viewer will face the same 22-file diff, the same layout plumbing, and the same review burden.

## What We're Proposing

### The Extension Host

A thin layer between the app's core layout and the panel content:

```
WITHOUT EXTENSION HOST:
_chat.$threadId.tsx
├── DiffPanel state + toggle + mutual exclusivity
├── BrowserPanel state + toggle + mutual exclusivity
├── PlanSidebar state + toggle + mutual exclusivity
├── [NextPanel] state + toggle + mutual exclusivity  ← grows linearly
└── Each new panel: ~150 lines of layout plumbing

WITH EXTENSION HOST:
_chat.$threadId.tsx
├── DiffPanel (stays separate — URL-routed)
└── ExtensionHost
    ├── Tab bar (automatic)
    ├── Panel chrome (automatic)
    ├── Availability filtering (automatic)
    └── builtinRegistry: [thread-overview, planning, preview, browser]
        └── Each new panel: 1 file + 1 registry line
```

### The API Contract

Extensions implement a simple interface:

```typescript
interface T3ExtensionDefinition {
  id: string;
  title: string;
  surface: "thread.sidePanel";
  order?: number;
  isAvailable: (context: ExtensionContext) => boolean;
  render: (context: ExtensionContext) => ReactNode;
}
```

The `ExtensionContext` provides read-only access to thread state (plan, approvals, work log, project metadata) plus panel management actions (open/close). Extensions don't need to understand the orchestration layer, WebSocket transport, or Zustand store internals.

### The Package Structure

Each extension lives in its own package, demonstrating how extensions could eventually be separate repos:

```
packages/
├── extension-api/              ← @t3tools/extension-api (the stable contract)
├── ext-thread-overview/        ← Thread signals and plan preview
├── ext-planning-workbench/     ← Requirements extraction + task drafts (with 12 tests)
├── ext-preview-workspace/      ← Dev server preview metadata
└── ext-browser/                ← Browser panel metadata
```

The web app imports and registers these extensions. The package boundary is the same boundary that would become a repo boundary later.

### Working with PR #963

PR #963 adds a full in-app browser. Our proposal shows how this can work with the extension host:

- **PR #963's infrastructure stays unchanged** — `browserManager.ts`, IPC contracts, `BrowserPanel.tsx`, `browserStateStore.ts` are not modified
- **The browser UI becomes an extension** — `browserExtension.tsx` wraps `BrowserPanel` as a `T3ExtensionDefinition`, connecting it to the browser state store and IPC through the existing APIs
- **The pattern generalizes** — any contributor can wrap a complex panel as an extension without modifying core layout code

This is NOT a competing approach. It's a complementary layer that makes PR #963's pattern reusable for future panels.

## What's Implemented

### Four working extensions

| Extension | Lines | Tests | What it does |
|-----------|-------|-------|-------------|
| Thread Overview | 59 | — | Thread signals, approvals, plan preview |
| Planning Workbench | 188 | 12 | Requirements extraction (code-fence-safe), task drafts, workspace export |
| Preview Workspace | 195 | — | Project-aware dev server preview with per-thread URL persistence |
| Browser Extension | 272 | — | Wraps PR #963's BrowserPanel as a pluggable extension |

### Extension host infrastructure

| Component | Lines | What it does |
|-----------|-------|-------------|
| types.ts | 48 | Extension definition, context, thread view types |
| registry.ts | 16 | Filter + sort extensions by surface and availability |
| ExtensionHost.tsx | 45 | Active extension management, tab derivation |
| ExtensionSidePanel.tsx | 49 | 360px panel with tab bar and close button |
| extensionSelectors.ts | 57 | Maps app state → extension-safe read model (with caching) |
| builtinRegistry.ts | 10 | Static array of registered extensions |
| **Total** | **225** | |

### Quality metrics

- **524 tests pass** (512 web app + 12 package)
- **Clean typecheck** across all packages
- **Two eng reviews** + one design review + one adversarial review (17 findings, all fixed)
- **Zero new dependencies** added

## Cost-Benefit Analysis

### Cost

- 225 lines of extension host infrastructure
- 5 new monorepo packages (minimal — mostly `package.json` + `tsconfig.json` + one source file)
- 30 lines of wiring in `ChatView.tsx`
- Learning curve: contributors learn the `T3ExtensionDefinition` interface (~5 minutes)

### Benefit

- **Adding a new panel goes from ~150 lines of core layout changes to 1 file + 1 registry line**
- **PRs for new panels don't touch core layout files** — smaller blast radius, faster review
- **Extensions are independently shippable** — a planning workbench doesn't block a browser panel
- **The pattern is proven** — PR #963's browser panel works as an extension with zero infrastructure modifications
- **Removal is trivial** — if the extension host is abandoned, it's a one-commit revert (it's additive, not replacing anything)

### What We're NOT Proposing

- Third-party extension marketplace
- Dynamic extension loading from URLs
- Extension sandboxing or security isolation
- Provider interception or middleware
- Stability guarantees for the extension API
- Any changes to the orchestration backend

## How This Compares to PR #963's Approach

PR #963 adds the browser as a first-class panel alongside the diff panel. This works, but it sets a precedent: every new panel type modifies `_chat.$threadId.tsx`, adds a new state store, and requires mutual-exclusivity logic with all other panels.

The extension host approach says: the browser panel is one of many possible panels, and the host manages the common concerns (tab switching, availability, panel chrome). The browser's unique concerns (WebContentsView, IPC, tab LRU) stay in `browserManager.ts` where they belong.

Both approaches are valid. The extension host doesn't replace PR #963 — it provides a pattern that makes PR #963's contribution reusable for future panels without repeating the 22-file integration effort.

## Next Steps

1. **Merge planning workbench improvements** — code fence stripping, shared PlanSteps component, expanded tests. Pure web-only changes, no controversy.
2. **Discuss extension host approach with maintainers** — this document + the working code is the conversation starter.
3. **If accepted:** Refactor PR #963's browser panel as an extension, remove hardcoded panel management from the chat route.
4. **If not accepted:** The extension host is additive and can be reverted in one commit. The planning workbench improvements stand on their own regardless.
