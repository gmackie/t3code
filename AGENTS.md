# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Branch Workflow

- `upstream/main` is the canonical upstream baseline when an `upstream` remote is configured. Keep the local `origin/main` branch pristine and updated from `upstream/main`; do not put feature commits on `origin/main`.
- In checkouts where `origin` already points at the upstream repository, treat `origin/main` itself as the pristine upstream baseline.
- Before starting or refreshing feature work, fetch the upstream baseline and rebase the feature branch onto the latest pristine main (`origin/main`, or `upstream/main` then update `origin/main`).
- Keep feature work on durable fork branches, normally under `gmackie/<feature-name>` or another explicit feature branch name in the fork. Do not delete these remote feature branches just because their work has landed in `main-local`.
- `main-local` is an integration branch for the local app: it should also be kept up to date with the latest pristine main, but its history is not the source of truth for individual feature work.
- It is acceptable for `main-local` to contain many features combined, merge commits, or local integration commits. Prefer clean, independently shippable feature commits/stacks on the feature branches.
- When a feature is useful in `main-local`, merge or cherry-pick it there from its feature branch, while preserving the feature branch so it can still be reviewed, shipped, or updated independently.
- If a feature needs more work after being integrated into `main-local`, make those updates on the feature branch rebased from latest `origin/main`, then bring the refreshed branch back into `main-local`.

## Desktop Release Safety

- Do not leave runnable `.app` backup bundles in `/Applications`. If a manual install needs a backup of an existing app, move it outside LaunchServices search paths, for example under `~/.config/superpowers/app-backups/`, before copying the replacement app into `/Applications`.
- For the Gmacko release stream, the app bundle must use the gmacko identity end to end: product name `T3 Code (gmacko)`, bundle id `com.t3tools.t3code.gmacko`, updater channel `gmacko`, updater cache `t3code-gmacko-updater`, state dir `userdata-gmacko`, and Electron userData dir `t3code-gmacko`.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.
