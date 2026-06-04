# Proposal: Browser Panel as an Extension

> This document shows how PR #963's in-app browser could be refactored to use the
> extension host system, and how additional extensions (planning workbench, preview
> workspace) compose alongside it.

## Current Architecture (PR #963)

PR #963 adds the browser panel as a hardcoded right-panel alongside the diff panel:

```
_chat.$threadId.tsx
├── ChatView (main content)
├── rightPanelStateStore → { selectedPanel: "diff" | "browser" | null }
├── DiffPanelInlineSidebar (when selectedPanel === "diff")
└── BrowserPanel (when selectedPanel === "browser")
    ├── browserStateStore (per-thread tabs, URL input)
    ├── BrowserPanel.tsx (tab strip, nav bar, viewport)
    └── BrowserManager (Electron WebContentsView lifecycle)
```

Each new panel type requires modifying `_chat.$threadId.tsx`, `ChatView.tsx`, and
`rightPanelStateStore.ts`. The panel switching logic is duplicated between the route
and the header.

## Proposed Architecture: Browser as Extension

The extension host already provides panel management, tab switching, and availability
filtering. The browser panel can be wrapped as a `T3ExtensionDefinition`:

```
_chat.$threadId.tsx
├── ChatView (main content)
├── ExtensionHost
│   ├── ExtensionSidePanel (tab bar, close button)
│   ├── Thread Overview extension
│   ├── Planning Workbench extension
│   ├── Browser extension (wraps BrowserPanel)
│   └── (future extensions added via builtinRegistry.ts only)
└── DiffPanelInlineSidebar (diff panel stays separate — it has deep URL routing)
```

### What Changes

| Component             | Before (PR #963)                     | After (extension)                                  |
| --------------------- | ------------------------------------ | -------------------------------------------------- |
| Panel switching       | `rightPanelStateStore`               | `ExtensionHost` tab bar                            |
| Browser toggle button | Custom in ChatHeader                 | Extension host "Extensions" button                 |
| Panel visibility      | `selectedPanel: "diff" \| "browser"` | `extensionPanelOpen` + `activeExtensionId`         |
| Browser state         | `browserStateStore` (unchanged)      | Same — extension reads it directly                 |
| BrowserPanel UI       | Rendered in route layout             | Rendered by extension's `render()`                 |
| BrowserManager        | Electron IPC (unchanged)             | Same — extension calls `readNativeApi().browser.*` |

### Browser Extension Definition

```typescript
// apps/web/src/extensions/builtins/browserExtension.tsx
import BrowserPanel from "../../components/BrowserPanel";
import { selectThreadBrowserState, useBrowserStateStore } from "../../browserStateStore";
import type { T3ExtensionDefinition } from "../types";

export const browserExtension: T3ExtensionDefinition = {
  id: "browser",
  title: "Browser",
  surface: "thread.sidePanel",
  order: 20,
  isAvailable: (_context) => true, // always available when a thread exists
  render: (context) => {
    // BrowserPanel is a controlled component — all state comes from browserStateStore
    // The extension wraps it and provides the store connection
    return <BrowserExtensionPanel context={context} />;
  },
};

function BrowserExtensionPanel({ context }: { context: ... }) {
  const threadId = context.activeThreadId;
  // ... connect browserStateStore, BrowserPanel props, keyboard shortcuts
  // BrowserPanel.tsx is unchanged — it's still a pure presentation component
}
```

### What Stays the Same

- `BrowserPanel.tsx` — unchanged (pure presentation component)
- `browserStateStore.ts` — unchanged (per-thread state)
- `browserManager.ts` — unchanged (Electron runtime)
- `browser.ts` — unchanged (utilities)
- IPC contracts — unchanged
- Keyboard shortcuts — unchanged (handled at route level, not extension level)

### What Gets Removed

- `rightPanelStateStore.ts` — replaced by extension host panel state
- Browser-specific code in `_chat.$threadId.tsx` — replaced by extension registration
- Browser toggle in `ChatHeader.tsx` — replaced by extension host "Extensions" button

### What Gets Simpler

Adding a new panel type (e.g., a terminal panel, a documentation panel) requires:

1. One file: the extension definition + component
2. One line: add to `builtinRegistry.ts`

No route changes, no header changes, no state store changes.

### Diff Panel: Why It Stays Separate

The diff panel has deep URL routing (`?diff=1&diffTurnId=...`), bookmark support, and
is triggered by in-chat actions (clicking diff buttons). It's not a panel the user
"opens from a tab bar" — it's a contextual view triggered by specific actions.

The extension host is for user-initiated panels. The diff panel is action-initiated.
They coexist: extension panel and diff panel are mutually exclusive (opening one closes
the other), but managed differently.

## Implementation Phases

### Phase 1: Ship Extension Host Improvements (Current — Workstream A)

- ✅ Code fence stripping in requirements extraction
- ✅ Shared PlanSteps component
- ✅ activePlan step rendering in planning workbench
- ✅ Action reordering (content before actions)
- ✅ Panel width matching (360px)
- ✅ Expanded test coverage

### Phase 2: Browser Extension Wrapper

- Create `browserExtension.tsx` that wraps `BrowserPanel` as a `T3ExtensionDefinition`
- Wire `browserStateStore` through the extension's render function
- Register in `builtinRegistry.ts`
- Requires: PR #963's BrowserPanel, browserStateStore, and IPC contracts

### Phase 3: Preview Workspace Extension

- Create `previewWorkspace.tsx` — a simpler browser experience focused on dev preview
- Pre-fills project's dev server URL
- Shows project scripts as context
- Uses the same `browserStateStore` and `NativeApi.browser` APIs
- Distinct from the general browser: project-aware, focused on the active dev server

### Phase 4: Remove Hardcoded Browser Panel

- Remove browser-specific code from `_chat.$threadId.tsx`
- Remove `rightPanelStateStore.ts`
- Browser panel is now just another extension

## Value Proposition

This refactoring demonstrates that the extension host is not just "another panel system"
— it's the system that makes adding panels trivial. The browser panel, planning
workbench, and preview workspace all register the same way. Future extensions (terminal,
docs viewer, test runner) follow the same pattern.

The cost of the extension host (types, registry, host component, side panel — ~400 lines)
pays for itself the moment the second panel type arrives. With PR #963's browser panel
as the second type, the host is already justified.
