# Document Link Panel Design

## Summary

Add a new right-panel document viewer so file links rendered inside LLM responses can open in-app instead of always jumping to the external editor.

V1 keeps the current single-slot right-panel model. Document viewing replaces the currently visible right panel content, similar to the diff panel today. The default click behavior is user-configurable, and `Cmd/Ctrl+Click` performs the opposite action for one-off overrides.

## Problem

Today, clicking a file link in assistant markdown always opens the target in the editor. That works for editing, but it is poor for lightweight inspection:

- It forces a context switch out of the app.
- It makes it harder to quickly inspect multiple referenced files while staying in the conversation.
- It does not fit the existing in-app panel model already used for diff inspection.

We want a read-only viewer for linked documents that feels like the diff panel, with syntax highlighting and line numbers, while preserving the existing editor-open workflow for users who prefer it.

## Goals

- Let users inspect linked files without leaving the app.
- Preserve the current editor-first workflow through settings and modifier override.
- Keep panel state predictable and durable using route-backed state.
- Reuse existing panel patterns where possible.
- Handle missing files, invalid targets, and large files predictably.

## Non-Goals

- Multi-tab right panels.
- Panel pinning or split-panel composition.
- Editing files inside the document panel.
- Search-in-file, file tree navigation, or multi-file history.
- Replacing the broader future flexible-panels work.

## Product Decisions

### Click behavior

Add a user setting:

- `Document link click behavior: Open in editor`
- `Document link click behavior: Open in document panel`

Plain click follows the setting.

`Cmd+Click` on macOS and `Ctrl+Click` on other platforms perform the opposite action.

This preserves current behavior for existing users who want it, while enabling an in-app review flow for users who prefer the document panel.

### Panel behavior

V1 uses the existing single active right-panel slot:

- `diff`
- `browser`
- `document`

Opening a document replaces the currently shown right panel content. If diff is open and the user opens a document in-panel, the document viewer becomes the active panel. Tabs are explicitly deferred to a future panel-system iteration.

## UX

### Entry points

- Markdown file links in assistant responses.

V1 does not add new entry points beyond markdown link handling.

### Document panel

The panel should feel like a sibling to the diff panel:

- Right-side panel in inline or sheet mode depending on viewport.
- Header with file name and relative path when available.
- Explicit `Open in editor` action in the header.
- Read-only content area.
- Syntax highlighting.
- Line numbers.
- Scroll to referenced line if the clicked target includes line or line/column data.

### Error and loading states

The panel must render explicit states instead of failing silently:

- Loading state while fetching file contents.
- Missing file state.
- Read failure state.
- Unsupported/too-large rendering fallback state.

Invalid markdown links that never resolved to a file target can remain no-ops or external links, matching current behavior. Once the app intentionally opens the document panel, failures should be visible in-panel.

## Architecture

### Right-panel model

Add a new right-panel kind:

- `document`

This should be treated as a peer to the existing diff and browser panels. The current route/view composition already assumes one active right panel at a time, which is the correct V1 scope.

### Route-backed state

Extend chat route search with document-specific params. Suggested shape:

- `doc=1`
- `docPath=<resolved path>`
- `docLine=<line>`
- `docColumn=<column>`

Exact naming can be adjusted, but the state should be explicit and parallel to diff search state.

Benefits:

- Survives refresh.
- Survives reconnects better than local component state.
- Makes panel state inspectable and debuggable.
- Creates a clean migration path to future flexible-panel work.

### Link handling

Markdown file links are already resolved in the chat markdown renderer. Change the click path from:

- resolve file path
- always open in editor

to:

- resolve file path
- inspect modifier key
- inspect user preference
- either open in editor or navigate to document panel route state

Modifier handling should invert the configured default action.

### File loading

The document panel should load file contents from the active thread worktree or project cwd context.

Requirements:

- Resolve relative links against the active workspace context.
- Support absolute paths when allowed by the current path-resolution rules.
- Re-resolve when thread/project context changes.

If no safe web-to-native file-read path exists yet, add the smallest backend/native API necessary for read-only file loading. V1 should avoid introducing a broad new filesystem abstraction if a narrow file-read endpoint is enough.

### Rendering

Reuse the existing highlighting approach where practical.

Expected rendering behavior:

- Infer language from file extension.
- Render highlighted text when file size is within acceptable bounds.
- Show line numbers.
- Scroll to target line after content loads.

For large files, prefer a deterministic fallback over expensive highlighting. For example:

- plain-text rendering without syntax highlighting past a threshold, or
- an explicit “file too large for highlighted preview” state

The exact threshold can be implementation-defined, but performance should win over cosmetic richness.

## Reliability and Failure Handling

This feature should be biased toward predictable behavior:

- Route state is the source of truth for the active document target.
- Missing files render an explicit panel state with the attempted path.
- Read errors render an explicit failure state.
- If the file cannot be syntax highlighted, render readable plain text instead of failing the panel.
- If a line number is out of bounds, show the file normally without a hard failure.

The panel should not block chat interaction if document loading fails.

## Testing

Cover three layers:

### 1. Path and target resolution

- Markdown hrefs that should resolve to local files.
- External links that should remain external.
- Line and column suffix handling.

### 2. Click behavior

- Plain click opens editor when preference is editor.
- Plain click opens panel when preference is panel.
- `Cmd/Ctrl+Click` inverts each default.

### 3. Route and panel rendering

- Search parsing/serialization for document panel state.
- Document panel opens for a valid target.
- Missing file state.
- Read failure state.
- Large-file fallback behavior.

## V1 Scope

Ship:

- User setting for default document-link behavior.
- New `document` right-panel mode.
- Route-backed document panel state.
- Plain click plus `Cmd/Ctrl+Click` inversion.
- Read-only document rendering with syntax highlighting and line numbers.
- Scroll-to-line support.
- Loading and failure states.

Defer:

- Panel tabs.
- Multiple open documents.
- In-panel editing.
- Search in file.
- Cross-thread document history.
- Integration with future flexible panel composition beyond the single-slot model.

## Recommended Implementation Order

1. Extend right-panel and route-search types for `document`.
2. Build the document panel shell and route-driven wiring.
3. Add file-content loading and rendering with large-file fallback.
4. Update markdown link click behavior to honor preference plus modifier inversion.
5. Add settings UI for the default behavior.
6. Add tests for route parsing, click behavior, and panel states.

## Future Compatibility

This design intentionally fits into a future, more flexible panel system:

- `document` is introduced as a first-class panel type now.
- V1 keeps a single active right-panel slot.
- Future tabbed or multi-panel work can lift `document` into a more composable panel container without changing the core document-target model or link semantics.
