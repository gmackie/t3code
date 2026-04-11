# Codex In-App Browser Automation Design

## Summary

Route Codex browser-based QA and testing through T3 Code's in-app Electron browser instead of a separate external browser harness.

V1 is intentionally narrow:

- Codex only.
- Full browser automation, not navigation-only.
- Hidden per-thread browser tabs that the UI can attach to.
- Shared browser session and shared imported cookies across threads.
- Browser panel auto-opens on first browser use for a thread and follows the active automation tab.
- User interaction immediately takes control away from the agent for that thread/tab.

The goal is to make browser-driven QA a first-class in-app capability while reusing the browser runtime, cookie manager, and UI already shipping on `main-local`.

## Problem

Today the app has two separate realities:

- T3 Code already has a real in-app browser in Electron, backed by `WebContentsView`, with tab state, viewport attachment, and cookie import.
- Agent-driven browser QA still conceptually belongs to an external browser/testing flow.

That split is wrong for this product direction.

We want browser-driven testing to happen inside T3 Code itself so that:

- imported local Chromium cookies are directly usable by agent QA,
- the user can watch QA runs in the same browser panel they already use,
- thread context and browser context stay aligned,
- there is one browser session model instead of separate app and testing browsers.

## Goals

- Let Codex use the in-app Electron browser for browser-based QA and testing.
- Support full browser automation:
  - navigate
  - inspect DOM
  - click
  - type
  - wait on page conditions
  - capture screenshots
  - inspect console and failed network activity
- Keep browser activity visible inside the existing thread browser panel.
- Reuse the shared in-app browser cookie jar so imported Chromium cookies work for QA immediately.
- Make user takeover deterministic and obvious.
- Preserve per-thread browser state while avoiding cross-thread tab fights.

## Non-Goals

- Claude support in v1.
- External gstack `/browse` integration in v1.
- Reproducing gstack's exact browser API surface in v1.
- Multiple isolated browser sessions or cookie jars per thread.
- A separate automation-only Chromium instance.
- Pixel-perfect test replay or recording.
- Full DevTools protocol parity.

## Product Decisions

### Provider scope

V1 is Codex-only.

The current provider/runtime path is already Codex-first, and that keeps the first implementation constrained to the existing Codex app-server integration.

### Control model

Codex browser actions run against hidden per-thread tabs managed by the Electron host.

The user-facing browser panel can attach to and display the active tab for the thread, but the browser tab itself is not a separate visible-only UI construct. It is the same underlying tab record the agent is driving.

### Auto-open behavior

When a thread uses the browser for the first time in a turn, the browser panel auto-opens for that thread and follows the active automation tab.

This should happen once per thread/session context, not repeatedly on every action if the panel was intentionally closed later by the user.

### User takeover

User interaction wins immediately.

If the user manually interacts with the active browser tab while Codex is driving it, the desktop layer transfers control to the user, emits a control-loss signal, and the active Codex browser tool call fails with a typed `browser_control_lost` style error.

Codex should not silently retry after losing control.

### Session model

All Codex browser tabs share the existing in-app browser session and cookie jar.

This means:

- imported cookies from the existing cookie manager are immediately usable by QA,
- sign-in state can persist across threads,
- browser automation reflects the user's actual app browser state.

Isolation is explicitly deferred.

## User Experience

### Browser panel behavior

The existing browser panel remains the single browser UI surface.

New behavior:

- the panel auto-opens when Codex first uses the browser in a thread,
- the panel attaches to the active automation tab for that thread,
- a status treatment indicates when Codex is currently controlling the browser,
- if the user takes over, the panel updates to show that the user now owns the tab.

### Timeline behavior

Browser actions appear in the thread timeline as normal tool lifecycle entries, not as a separate event family in v1.

Examples:

- `Navigate browser`
- `Click button`
- `Wait for selector`
- `Capture screenshot`
- `Read browser diagnostics`

This should reuse the existing work/timeline rendering pipeline for tool calls rather than inventing a second browser-specific timeline model immediately.

### Error visibility

When a browser action fails, the user should be able to understand why from the timeline and browser panel state.

Failure examples:

- selector not found
- navigation timeout
- page crashed
- element not interactable
- browser control lost to user

Where practical, failures should include screenshot and diagnostics references in the tool result summary.

## Architecture

The implementation should be split into three layers:

### 1. Desktop browser automation host

Owns real browser execution.

This extends the current browser runtime in [browserManager.ts](/Users/mackieg/.config/superpowers/worktrees/t3code/main-local/apps/desktop/src/browserManager.ts) from a tab/view manager into an automation-capable browser host.

Responsibilities:

- create and manage hidden per-thread automation tabs,
- attach/detach those tabs to the visible browser panel viewport,
- maintain per-tab control ownership state,
- execute browser actions against `webContents`,
- buffer recent console and failed-network events,
- capture screenshots,
- surface structured automation errors.

### 2. Desktop bridge and shared contracts

Owns the typed local IPC boundary.

The existing desktop bridge in [ipc.ts](/Users/mackieg/.config/superpowers/worktrees/t3code/main-local/packages/contracts/src/ipc.ts) should gain a dedicated automation surface rather than overloading the current tab shell methods.

The contract should be high-level and app-native, not a thin wrapper around arbitrary DOM eval.

Suggested capability family:

- `browserAutomationEnsureTab`
- `browserAutomationNavigate`
- `browserAutomationInspect`
- `browserAutomationClick`
- `browserAutomationType`
- `browserAutomationWait`
- `browserAutomationScreenshot`
- `browserAutomationDiagnostics`
- `browserAutomationReleaseControl`

Exact names can vary, but the split between tab-shell actions and automation actions should stay explicit.

### 3. Server-side Codex browser tool service

Owns Codex-facing tool exposure.

The server should introduce a Codex-only browser tool adapter that lives beside the current Codex provider integration in [codexAppServerManager.ts](/Users/mackieg/.config/superpowers/worktrees/t3code/main-local/apps/server/src/codexAppServerManager.ts) and [CodexAdapter.ts](/Users/mackieg/.config/superpowers/worktrees/t3code/main-local/apps/server/src/provider/Layers/CodexAdapter.ts).

This service should:

- expose a compact T3-native browser tool family to Codex,
- translate Codex tool invocations into desktop automation bridge calls,
- associate automation tabs with the active thread,
- normalize tool results and failures into existing provider runtime events.

V1 should not attempt to mirror gstack's exact `/browse` command grammar.

## Browser Tool Surface

V1 should expose a compact, semantic-first automation surface for Codex.

Recommended actions:

- `browser.navigate`
  - open URL in the thread's automation tab
- `browser.inspect`
  - read page metadata, visible text excerpts, matched elements, and page state
- `browser.click`
  - click by selector, role/name, text, or indexed match
- `browser.type`
  - focus and type into an element, optionally clearing first
- `browser.wait`
  - wait for selector, text, navigation, load completion, or network idle within reason
- `browser.screenshot`
  - capture a screenshot and return a reference usable in timeline/tool output
- `browser.diagnostics`
  - return recent console entries, failed requests, and page error state

These tools should be semantic-first:

- prefer selector and role/text targeting over coordinates,
- prefer explicit waits over arbitrary sleeps,
- return structured errors and structured result payloads.

## Automation Semantics

### Tab model

Each thread gets its own automation tab identity.

That tab may be hidden when the panel is closed, but it remains the authoritative browser state for the thread.

The browser panel simply attaches to the active thread tab when visible.

### Targeting

DOM interaction should be semantic-first:

- CSS selector
- visible text
- ARIA role and accessible name
- optionally nth-match for ambiguous results

Coordinate-based interaction should not be the primary API in v1.

### Waiting

The wait model should expose explicit conditions:

- selector present
- selector visible
- text present
- URL change or navigation complete
- page idle/loading complete

Avoid introducing arbitrary sleep-first usage patterns into the tool design.

### Diagnostics

Each tab should maintain a small ring buffer of:

- console messages,
- uncaught page errors,
- failed network requests.

Diagnostics should be queryable directly and should also be included automatically in failed action responses when relevant.

### Screenshots

Screenshots should be captured by the desktop host and returned as stable file references or attachment-like artifacts the app can show in the timeline.

V1 does not need full video or trace recording.

## Control and Ownership

Each automation tab should track:

- current owner: `agent`, `user`, or `idle`
- owning thread id
- owning run/turn metadata where available

Rules:

- Codex actions acquire agent control before acting.
- If the panel is merely observing, agent control remains.
- If the user actively interacts with the page, control flips to `user`.
- Once control flips, the in-flight tool call fails with a typed control-loss error.
- Future Codex actions must explicitly reacquire control, rather than assuming ownership still exists.

The desktop host should be the source of truth for control state.

## Web App Integration

The web app should stay thin and stateful, not execution-heavy.

Required additions:

- thread-level browser automation status in browser UI state,
- auto-open-on-first-browser-use behavior,
- follow-active-agent-tab behavior,
- visual status for:
  - browsing idle
  - Codex controlling browser
  - user took over
- timeline-friendly tool labels for browser actions.

The existing browser panel component in [BrowserPanel.tsx](/Users/mackieg/.config/superpowers/worktrees/t3code/main-local/apps/web/src/components/BrowserPanel.tsx) should remain the primary UI, with minimal new chrome for ownership/status.

## Server Integration Details

The server needs a clean boundary between provider logic and desktop-local browser execution.

Recommended structure:

- introduce a local browser automation service interface on the server side,
- bind it only when running in the desktop-managed environment,
- make Codex browser tools unavailable when the app is not running with the desktop bridge.

If the desktop automation host is unavailable, Codex should not advertise these tools for that thread/session.

This is preferable to advertising the tools and failing every invocation.

## Reliability and Failure Handling

This feature should prefer explicit failure over implicit fallback.

Rules:

- if no desktop automation host is present, do not expose browser tools,
- if the tab crashes, return a typed page/browser crash error,
- if the target cannot be found, return a typed selector/targeting error,
- if a wait times out, return timeout plus current URL and recent diagnostics,
- if the user takes over, fail immediately with control-loss metadata,
- if screenshot capture fails, do not hide the underlying action failure.

The browser panel must not become unusable if automation fails; the user should still be able to inspect or continue manually.

## Security and Scope Controls

V1 keeps scope intentionally local:

- Codex only,
- desktop-managed local app only,
- shared in-app browser session only.

The server should not expose this automation surface to arbitrary remote clients in v1.

Tool results should avoid dumping full cookie contents or other sensitive browser storage into the model context. The existing cookie manager rule remains: metadata is visible, cookie values are not shown in UI. Browser automation should follow the same principle.

## Testing

Cover four layers.

### 1. Shared contracts

- schema encoding/decoding for automation requests and results
- typed error payload coverage

### 2. Desktop host

- hidden tab creation and reuse per thread
- attach/detach behavior when panel opens or closes
- control ownership transitions
- user takeover detection
- console/network ring buffer behavior
- screenshot capture result handling

### 3. Server Codex tool mapping

- tool registration only when desktop automation is available
- tool invocation routing to the desktop bridge
- failure mapping into normal Codex tool lifecycle events
- no tool exposure outside Codex v1 sessions

### 4. Web integration

- browser panel auto-opens on first browser tool usage
- panel follows active automation tab for the thread
- control status changes render correctly
- timeline entries render browser actions as tool lifecycle entries
- takeover state is visible after manual interaction

## Acceptance Criteria

The feature is complete for v1 when all of the following are true:

- A Codex thread can open a URL in the in-app browser.
- Codex can inspect the page, click, type, wait, and navigate successfully.
- Codex can capture a screenshot and read browser diagnostics.
- Imported Chromium cookies from the existing cookie manager are usable by Codex browser actions.
- The browser panel auto-opens on first browser use for the thread and shows the active tab.
- If the user manually interacts with the tab during automation, the in-flight Codex action fails with a control-loss error and the UI reflects user ownership.
- Browser actions appear in the existing timeline/work-log system with readable labels and errors.

## V1 Scope

Ship:

- Codex-only browser automation tools backed by the in-app Electron browser
- hidden per-thread automation tabs
- shared browser session and shared imported cookies
- semantic DOM interaction plus waits
- screenshots plus diagnostics
- browser panel auto-open and follow behavior
- immediate user takeover
- timeline integration through existing tool lifecycle entries

Defer:

- Claude support
- gstack external `/browse` integration
- per-thread isolated browser sessions
- trace/video recording
- raw DevTools protocol exposure
- coordinate-first action APIs
- remote/non-desktop exposure
