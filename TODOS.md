# TODOS

## Add terminal dispatch action to ExtensionContext

**What:** Allow extensions to run project scripts by adding a `runProjectScript` action to `ExtensionContext`.

**Why:** The preview workspace extension shows project scripts as display-only badges because `ExtensionContext.actions` has no way to trigger script execution. The existing `commandForProjectScript()` utility in `apps/web/src/projectScripts.ts` already constructs keybinding commands — the gap is bridging from extension context to that utility.

**Pros:** Preview workspace becomes a true project control surface. Unblocks click-to-run for all future extensions.

**Cons:** Requires adding a new action type to `ExtensionContext` and wiring it through `ChatView.tsx` to the terminal/keybinding system.

**Depends on:** Preview workspace extension being shipped.

**Where to start:** `apps/web/src/extensions/types.ts` → add `runProjectScript` to `HostWorkflowAction` identifiers. Wire in `ChatView.tsx` where `extensionContext` is constructed (~line 762).

## Add embedded preview mode (WebContentsView inside main window)

**What:** Embed the preview inside the main T3 Code window using Electron's `WebContentsView`, with pop-out to a separate window.

**Why:** The design review (D3A) decided on embedded + pop-out, but eng review (3A) phased it to ship pop-out-only first. Embedded mode gives an inline preview without leaving the main window — more integrated dev experience.

**Pros:** Inline preview, no window switching. Pop-out available when users want a separate window.

**Cons:** Requires restructuring how the main `BrowserWindow` loads the web app — from `loadURL()` to `contentView` with two child `WebContentsView`s (one for the app, one for the preview). High-risk change to `apps/desktop/src/main.ts` (42KB).

**Depends on:** Preview workspace Phase 1 (pop-out BrowserWindow) shipping first. The IPC channels and lifecycle management from Phase 1 are reusable.

**Where to start:** Research Electron 40's `WebContentsView` API. Prototype moving the web app from `BrowserWindow.loadURL()` to a `WebContentsView` child of the main window's `contentView`. Once that works, add the preview as a second child view with `setBounds` for side-by-side layout.
