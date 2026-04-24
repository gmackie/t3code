# Mobile Tailnet Control App Design

Date: 2026-04-24
Branch: `main-local`
Status: approved for planning

## Summary

Build an iPhone-first mobile app that acts as a privileged remote control for T3 Code sessions running on a Mac. The Mac remains the only execution host. The phone connects directly to the Mac over Tailscale, pairs once with a one-time credential, then uses authenticated HTTP and WebSocket access for ongoing control.

This is not a relay architecture, and it is not an on-device agent runtime. It is a direct Tailnet client for an existing T3 Code server.

## Why This Exists

The product job is not "view chats on your phone." The product job is:

- monitor active threads away from the Mac
- respond to approvals and option selection requests
- send follow-up prompts quickly
- inspect enough context to make the next decision
- recover stuck or disconnected runs fast

The mobile app should make a run feel operable when the Mac is not physically in front of you.

## Product Wedge

### V1 goals

- connect directly to an existing T3 Code server on a Mac over Tailscale
- support existing projects only
- support full thread control for those projects
- support live monitoring of thread activity
- support approvals, option selection, and prompt replies
- support recovery actions for stuck sessions

### V1 non-goals

- creating projects from the phone
- running coding agents on-device
- public internet relay infrastructure
- push branch, create PR, merge, or other destructive external side effects
- arbitrary project script execution
- Android support in the first release

## Recommended Approach

Build a native iPhone app in a new `apps/mobile` workspace package. Reuse shared contracts from `packages/contracts` and extract transport/auth client logic into a shared runtime module instead of copying web-specific code.

Use direct Tailnet transport:

- Mac runs the T3 Code server
- desktop app exposes a Tailnet endpoint
- iPhone app pairs with a one-time credential
- iPhone stores a long-lived bearer session securely
- iPhone uses short-lived WebSocket tokens for live control streams

## Existing Repo Capabilities We Should Reuse

The current codebase already contains most of the hard primitives:

- pairing URL and QR bootstrap support in `apps/server/src/startupAccess.ts`
- auth contracts for bootstrap credentials, bearer sessions, and WebSocket tokens in `packages/contracts/src/auth.ts`
- authenticated auth routes in `apps/server/src/auth/http.ts`
- authenticated WebSocket RPC route in `apps/server/src/ws.ts`
- desktop server exposure settings in `apps/desktop/src/serverExposure.ts`
- remote environment pairing UI and saved environment concepts in the web app

This means mobile is an extension of the current server/auth model, not a separate backend program.

## Architecture

### System model

- the Mac is the source of truth for projects, threads, provider sessions, workspace state, and git state
- the mobile app is a remote client with authenticated access to the same orchestration model
- Tailscale is the network path, not an application-layer relay

### Exposure model

The current desktop exposure distinction is too coarse:

- `local-only`
- `network-accessible`

Add a third mode:

- `tailnet-accessible`

`tailnet-accessible` should be the preferred remote mode for the desktop app. It should:

- prefer a Tailscale IP or MagicDNS hostname when available
- advertise that endpoint explicitly in settings
- fail closed back to `local-only` if no Tailscale endpoint is available
- avoid the vague semantics of "open to all interfaces and hope the user understands the consequences"

Retain `network-accessible` for generic LAN or advanced cases, but treat `tailnet-accessible` as the recommended path for mobile.

### Auth and pairing flow

1. Mac exposes a Tailnet-reachable endpoint.
2. Mac creates a one-time pairing credential.
3. Desktop app displays a QR code or pairing URL using the Tailnet endpoint.
4. iPhone scans the QR code or opens the pairing URL.
5. iPhone calls `POST /api/auth/bootstrap/bearer`.
6. Server exchanges the bootstrap credential for a bearer session.
7. iPhone stores the returned bearer token in Keychain.
8. iPhone calls `POST /api/auth/ws-token` as needed.
9. iPhone connects to `/ws` using the issued WebSocket token.

This keeps the current trust model intact:

- bootstrap credentials are for first-time pairing
- bearer sessions are for steady-state authenticated access
- WebSocket tokens are short-lived transport credentials

### Trust boundary

V1 should treat the mobile app as a trusted operator for orchestration actions, but not for destructive outward side effects.

Allowed in v1:

- view threads and session state
- send prompts and replies
- respond to approvals and option requests
- reconnect or recover sessions
- inspect changed files and small diffs

Deferred to v2 or a second trust tier:

- push branch
- create PR
- merge
- run arbitrary project scripts
- any action that mutates remote services outside the local T3 Code control plane

## Mobile Product Model

### Core promise

If a run gets weird, the phone can fix it.

If a run needs input, the phone can provide it.

If a run is active, the phone can monitor it without feeling blind.

### Screen model

Ship four primary surfaces:

1. Inbox
2. Threads
3. Thread detail
4. Settings and access

#### Inbox

The inbox is the "what needs me now" view. It should surface:

- blocking approvals
- pending option selections
- stuck or disconnected sessions
- recently completed runs worth checking
- threads with unseen meaningful activity

This is the default launch destination for mobile.

#### Threads

The threads view is a compact, scannable list grouped by environment and project. It should optimize for:

- resuming recent work
- checking which sessions are running
- seeing which thread needs intervention

#### Thread detail

This is the main operator screen. It should support:

- live transcript rendering
- composer for prompts and replies
- approval cards
- option-picker UI
- session status and provider health
- changed-file summary
- compact diff or file preview
- one-tap recovery actions

Recovery actions should be pinned and explicit:

- reconnect stream
- stop current run
- restart provider session
- recreate thread session as a last resort

#### Settings and access

This view should manage:

- paired environments
- current session/device state
- re-pair and revoke flows
- display of the active Tailnet endpoint

## UX Principles

- optimize for intervention, not exploration
- default to the smallest amount of information needed to make the next decision
- keep destructive actions visually separate
- treat reconnect and resume as ordinary, not exceptional
- always show whether the data is live, reconnecting, or stale

The mobile app should feel like a control surface, not a shrunk desktop UI.

## Data and Sync Model

### Local cache

The mobile app should persist a small local cache of:

- paired environments
- projects and thread list
- recent thread messages
- latest session status
- changed-file summaries
- inbox state

The cache exists to make resume and reconnect feel fast. It is not authoritative.

### Reconnect behavior

The app must assume frequent interruption:

- app backgrounding
- network changes
- screen lock
- temporary Tailnet disconnects

On resume:

- revalidate bearer session
- request a fresh WebSocket token if needed
- reconnect the stream
- fetch any missed snapshots or events
- clearly indicate stale versus live state during the transition

The mobile app should degrade to "stale but usable" instead of blank.

## Components

### Server changes

- add `tailnet-accessible` exposure mode to desktop/server contracts
- detect and advertise Tailscale endpoint in desktop settings
- generate Tailnet-based pairing URLs when applicable
- ensure remote auth posture is explicit and visible in server descriptors
- verify all thread-control operations needed by mobile are available through existing RPC or add minimal missing endpoints

### Shared packages

- keep `packages/contracts` as the source of truth for mobile-visible schemas
- extract reusable auth/environment client logic into a shared runtime package
- avoid importing web UI logic directly into mobile

### Mobile app

- environment list and pairing flow
- thread list and inbox data model
- live thread detail client
- auth token storage and refresh path
- reconnect manager
- compact diff/file preview components

## Error Handling

### Expected failure modes

- Tailscale endpoint unavailable
- expired or revoked mobile session
- WebSocket token expiry
- app background disconnect
- provider session exists but is stalled
- thread exists but live stream is temporarily unavailable

### Required handling

- show actionable recovery states, not generic errors
- preserve the last known thread context locally
- offer reconnect before destructive restart
- distinguish auth failure from transport failure
- distinguish stale session from stuck provider runtime

## Security

- store mobile bearer sessions in Keychain only
- treat pairing URLs and pairing credentials as secrets
- use short-lived WebSocket tokens
- make device revocation visible and easy from the owner session
- avoid broad default LAN exposure when the intent is Tailnet-only access

## Implementation Phases

### Phase 1

- scaffold `apps/mobile`
- implement environment pairing and persistence
- implement environment/thread list
- implement live read-only thread detail

### Phase 2

- implement composer
- implement approvals and option selection
- implement reconnect and recovery controls
- implement inbox view

### Phase 3

- implement changed-file summaries and compact diff/file preview
- polish background/resume behavior
- polish access management and device/session clarity

## Testing

### Server and contract coverage

- contract tests for new `tailnet-accessible` exposure mode
- desktop tests for Tailscale endpoint detection and fallback
- auth flow tests for bearer bootstrap from pairing URL
- WebSocket reconnect tests for mobile-style token refresh

### Mobile coverage

- pairing flow tests
- environment persistence tests
- transcript rendering and approval action tests
- reconnect and background/resume lifecycle tests
- inbox prioritization logic tests

### End-to-end validation

- pair iPhone to local Mac over Tailnet
- start a session on Mac and observe it on phone
- reply from phone and verify server-side effect
- trigger an approval request and resolve it from phone
- simulate disconnect/background/resume and verify resync
- simulate a stuck run and recover it from phone

## Open Questions

- whether `tailnet-accessible` should advertise MagicDNS, raw Tailscale IP, or both
- whether mobile needs read-only file browsing in v1 beyond changed files and previews
- whether certain git-side effects should graduate behind a second trust gate in v1.5

## Recommendation

Proceed with an iPhone-first native mobile app backed by direct Tailscale connectivity to the Mac-hosted T3 Code server.

Do not build a relay service.

Do not chase full desktop parity.

Ship the control surface first: inbox, live thread view, approvals, prompts, and recovery.
