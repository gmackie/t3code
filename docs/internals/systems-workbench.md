# Systems Workbench

The model semantics live in `packages/systems-*` and are specified by RFC-001 (Systems Workbench
Model IR and Execution Semantics v0.1). This page covers only how T3 hosts them.
[`SystemsService`](../../apps/server/src/systems/SystemsService.ts) owns loading, compilation, the
run queue, workers and run storage. The `systems.*` WebSocket RPCs and the `t3_systems_*` MCP tools
([toolkit](../../apps/server/src/mcp/toolkits/systems/handlers.ts)) both call it, so add capabilities
as service methods.

## Runs live outside thread lifecycle

RFC-001 INV-06 says a run belongs to the environment, not a thread, tab or connection. The service
is built once in `server.ts` and the WebSocket layer reuses that instance, like the Reverse
Workbench. A per-connection instance would tie runs to sockets. Closing a client never cancels a
run, and a reconnecting client gets the same run id, status and event cursors.

Trace events and probe samples are stored in `systems_run_events` and `systems_run_samples`,
never in orchestration events. A run can produce far more rows than a thread, and RFC-001 §11.2
keeps high-volume signals out of agent history. These tables have their own migration table
([`SystemsMigrations.ts`](../../apps/server/src/systems/SystemsMigrations.ts)), as the engine's
do, because fork schema in the shared ledger can be masked by a later upstream id (see
[Divergent migration ids](legacy-orchestration-migration.md#divergent-migration-ids)).

## Worker isolation

Simulation is synchronous, CPU-bound code. Each run executes in a `node:worker_threads` worker
([`systems-worker.ts`](../../apps/server/src/systems-worker.ts)) so the server's event loop never
waits on it. The worker steps a bounded number of boundaries, posts that chunk's new trace and
samples, then waits for `continue` or `cancel`. The host commits each chunk before it answers. That
handshake bounds memory, lets cancellation land between chunks, and means a crash or restart loses
at most one uncommitted chunk. Runs that reach the queue wait for one of two slots per environment.

A single-file executable has no sibling script for a worker to load. There the same driver
([`SystemsWorkerProtocol.ts`](../../apps/server/src/systems/SystemsWorkerProtocol.ts)) runs
in-process: each chunk stays bounded and the handshake yields to the event loop, but a large chunk
still briefly blocks it.

## Immutability and digests

A run stores its compiled plan and experiment when it is created, so editing the model afterwards
never changes what the run executes or reports. A restart re-queues a queued run from that stored
plan and fails a running one as `interrupted`, keeping its committed rows. Each record carries the
RFC-001 INV-08 fields. The run digest covers plan, experiment, input stream, solver and seed (RFC-001
§3.1), and a new parameter set is always a new run (RFC-001 §12). `create` and `cancel` take
idempotency keys, so retrying after a dropped connection is safe.

## Bounded queries

Nothing a client asks for scales with the length of a run. Events page by sequence cursor, at most
500 per request. Signals take a time range and a point budget. Above the budget, each time bucket
returns its minimum and maximum sample, so peaks survive downsampling (RFC-001 §11.2). The
run list returns the latest 100 runs. Progress pushes to subscribers at most every 250 ms per run.
Expected-trace comparison is the one whole-run read, and it refuses runs over a fixed row limit.

## Paths

Clients name a systems project by project id and project-relative path. The service resolves it
under the project's real root and rejects traversal and symlinks (RFC-001 §13.3). It then reads only
files reachable by reference from `systems.project.json` (`readReferencedFiles` in systems-model),
so a project at a repository root never walks `node_modules`. Sources are parsed strictly, so
duplicate JSON keys are diagnostics rather than silently resolved.

## Agent capabilities

RFC-001 §13.3 names eight capabilities. They are not a second permission system: each one maps
onto how T3 already scopes an MCP caller, in
[`authority.ts`](../../apps/server/src/mcp/toolkits/systems/authority.ts).

| Capability                       | Who holds it                                                                                                                                                                                     | Enforced by                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `model.read`                     | Every MCP caller, read-only clients included                                                                                                                                                     | `McpToolAccess.reads`                                                |
| `simulation.execute`             | Callers `McpToolAccess.writes` admits: not read-only clients, live thread callers only. Fenced links may start runs, not cancel them                                                             | `writes`, with `linkedCallers: "allowed"` for create and conformance |
| `model.edit`                     | Default interaction mode at `auto-accept-edits` or above, the mode at which the caller already writes files unasked. Below full access, a thread only edits its own project. Never a fenced link | `patchModel` checks the authority                                    |
| `instrument.observe`, `device.*` | Nobody, since no adapter exists                                                                                                                                                                  | `requestDevice` checks the authority                                 |

Callers come with their limits already applied. A delegated child runs at its own modes, which
delegation never lets exceed its parent's. A native subagent calls as its parent thread. A caller
from a linked environment is a client capped by its link's access and the calling agent's
`T3-Mode-Limit`.

Model patches are declared as reads, so a caller without `model.edit` gets a typed `E-AUTH-001`
instead of a generic MCP refusal, and may still `dryRun`. A patch is RFC 6902 `add`/`remove`/`replace`
(Effect's `JsonPatch`). Its pointers are the same JSON pointers diagnostics carry, and it reaches
every document kind, so a layout needs no separate operation set. Safety comes from what happens
after the edit, not from the operation vocabulary. The patched bytes stand in for the file in the
pack (`readReferencedFiles` overlay), and the file's closure plus every system using it is validated
and compiled. The file is renamed into place only if its sha256 still equals `expectedRevision`,
checked again just before the write. One patch runs at a time per environment.

RFC-001 AUTH-001 requires that a denial happens before any device adapter runs. `requestDevice`
authorizes first and only then looks for an adapter. None is installed, so even an authorized
caller gets `unavailable`. The service accepts an adapter only as a construction option, which
the AUTH-001 test uses to prove the adapter is never reached.
