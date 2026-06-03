# Linear Task Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a provider-neutral task integration layer, with Linear as the first provider, so users can start a thread/worktree from a Linear issue.

**Architecture:** Build `TaskProvider` as a sibling to `SourceControlProvider`, not as a source-control subtype. Contracts stay schema-only in `packages/contracts`; server runtime owns provider implementations, settings, auth, and task preparation; web consumes provider-neutral task RPCs and renders Linear-first UI. V1 uses a server-side Linear API token and delegates branch/worktree creation to existing VCS/Git worktree paths.

**Tech Stack:** TypeScript, Effect services/layers, Effect Schema, WebSocket RPC via `packages/contracts/src/rpc.ts`, Bun/Vitest, Linear GraphQL API over fetch.

## Current Relevant Code

- Source-control contracts: `packages/contracts/src/sourceControl.ts`
- Settings contracts: `packages/contracts/src/settings.ts`
- RPC contracts: `packages/contracts/src/rpc.ts`, `packages/contracts/src/ipc.ts`
- Web RPC client: `packages/client-runtime/src/wsRpcClient.ts`
- Environment API facade: `apps/web/src/environmentApi.ts`
- Server RPC handlers: `apps/server/src/ws.ts`
- Source-control provider pattern: `apps/server/src/sourceControl/SourceControlProvider.ts`, `apps/server/src/sourceControl/SourceControlProviderRegistry.ts`
- Pull request prepare flow: `apps/server/src/git/GitManager.ts`, `apps/web/src/components/PullRequestThreadDialog.tsx`
- Existing VCS worktree operations: `packages/contracts/src/git.ts`, `apps/server/src/git/GitManager.ts`

## Task 1: Add Task Contracts

**Files:**

- Create: `packages/contracts/src/task.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/task.test.ts`

**Step 1: Write failing schema tests**

Create `packages/contracts/src/task.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as Schema from "effect/Schema";
import { TaskItem, TaskPrepareThreadResult, TaskProviderKind, TaskReference } from "./task.ts";

describe("task contracts", () => {
  it("decodes provider kinds", () => {
    assert.equal(Schema.decodeSync(TaskProviderKind)("linear"), "linear");
  });

  it("decodes a minimal task item", () => {
    const task = Schema.decodeSync(TaskItem)({
      provider: "linear",
      id: "issue-id",
      key: "ENG-123",
      title: "Fix startup",
      url: "https://linear.app/acme/issue/ENG-123/fix-startup",
      state: "open",
      labels: [],
      comments: [],
    });

    assert.equal(task.key, "ENG-123");
    assert.equal(task.comments.length, 0);
  });

  it("decodes task references and prepare results", () => {
    assert.equal(Schema.decodeSync(TaskReference)("ENG-123"), "ENG-123");
    const result = Schema.decodeSync(TaskPrepareThreadResult)({
      task: {
        provider: "linear",
        id: "issue-id",
        key: "ENG-123",
        title: "Fix startup",
        url: "https://linear.app/acme/issue/ENG-123/fix-startup",
        state: "open",
        labels: [],
        comments: [],
      },
      branch: "linear/eng-123-fix-startup",
      worktreePath: null,
      initialPrompt: "Task context...",
    });

    assert.equal(result.branch, "linear/eng-123-fix-startup");
  });
});
```

**Step 2: Run failing tests**

Run:

```bash
cd packages/contracts && bun run test src/task.test.ts
```

Expected: FAIL because `task.ts` does not exist.

**Step 3: Add contracts**

Create `packages/contracts/src/task.ts`:

```ts
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString, PositiveInt } from "./baseSchemas.ts";
import { ThreadId } from "./orchestration.ts";

export const TaskProviderKind = Schema.Literals(["linear", "github-issues", "jira", "unknown"]);
export type TaskProviderKind = typeof TaskProviderKind.Type;

export const TaskState = Schema.Literals(["open", "in_progress", "done", "canceled", "unknown"]);
export type TaskState = typeof TaskState.Type;

export const TaskComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  authorName: Schema.Option(TrimmedNonEmptyString),
  bodyMarkdown: TrimmedNonEmptyString,
  createdAt: Schema.Option(Schema.DateTimeUtc),
  updatedAt: Schema.Option(Schema.DateTimeUtc),
});
export type TaskComment = typeof TaskComment.Type;

export const TaskItem = Schema.Struct({
  provider: TaskProviderKind,
  id: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  state: TaskState,
  statusName: Schema.optional(TrimmedNonEmptyString),
  assigneeName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  labels: Schema.Array(TrimmedNonEmptyString),
  comments: Schema.Array(TaskComment),
  descriptionMarkdown: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  suggestedBranchName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: Schema.optional(Schema.DateTimeUtc),
});
export type TaskItem = typeof TaskItem.Type;

export const TaskReference = TrimmedNonEmptyString;
export type TaskReference = typeof TaskReference.Type;

export const TaskLookupInput = Schema.Struct({
  provider: TaskProviderKind,
  reference: TaskReference,
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type TaskLookupInput = typeof TaskLookupInput.Type;

export const TaskListInput = Schema.Struct({
  provider: TaskProviderKind,
  query: Schema.optional(Schema.String),
  cwd: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt),
});
export type TaskListInput = typeof TaskListInput.Type;

export const TaskListResult = Schema.Struct({
  tasks: Schema.Array(TaskItem),
});
export type TaskListResult = typeof TaskListResult.Type;

export const TaskPrepareMode = Schema.Literals(["local", "worktree"]);
export type TaskPrepareMode = typeof TaskPrepareMode.Type;

export const TaskPrepareThreadInput = Schema.Struct({
  provider: TaskProviderKind,
  reference: TaskReference,
  cwd: TrimmedNonEmptyString,
  mode: TaskPrepareMode,
  threadId: Schema.optional(ThreadId),
});
export type TaskPrepareThreadInput = typeof TaskPrepareThreadInput.Type;

export const TaskPrepareThreadResult = Schema.Struct({
  task: TaskItem,
  branch: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  initialPrompt: TrimmedNonEmptyString,
});
export type TaskPrepareThreadResult = typeof TaskPrepareThreadResult.Type;

export const TaskProviderDiscoveryStatus = Schema.Literals([
  "available",
  "missing-token",
  "disabled",
]);
export type TaskProviderDiscoveryStatus = typeof TaskProviderDiscoveryStatus.Type;

export const TaskProviderDiscoveryItem = Schema.Struct({
  kind: TaskProviderKind,
  label: TrimmedNonEmptyString,
  status: TaskProviderDiscoveryStatus,
  detail: Schema.Option(TrimmedNonEmptyString),
});
export type TaskProviderDiscoveryItem = typeof TaskProviderDiscoveryItem.Type;

export class TaskProviderError extends Schema.TaggedErrorClass<TaskProviderError>()(
  "TaskProviderError",
  {
    provider: TaskProviderKind,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Task provider ${this.provider} failed in ${this.operation}: ${this.detail}`;
  }
}
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./task.ts";
```

**Step 4: Verify tests pass**

Run:

```bash
cd packages/contracts && bun run test src/task.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/contracts/src/task.ts packages/contracts/src/task.test.ts packages/contracts/src/index.ts
git commit -m "feat: add task provider contracts"
```

## Task 2: Add Linear Settings

**Files:**

- Modify: `packages/contracts/src/settings.ts`
- Test: `packages/contracts/src/settings.test.ts`
- Modify if needed: `apps/server/src/serverSettings.ts`

**Step 1: Write failing settings tests**

In `packages/contracts/src/settings.test.ts`, add tests that decode defaults and patches:

```ts
it("defaults Linear task settings to disabled with no API token", () => {
  const settings = Schema.decodeSync(ServerSettings)({});
  assert.equal(settings.tasks.linear.enabled, false);
  assert.equal(settings.tasks.linear.apiToken, "");
});

it("accepts Linear task settings patches", () => {
  const patch = Schema.decodeSync(ServerSettingsPatch)({
    tasks: {
      linear: {
        enabled: true,
        apiToken: "lin_api_test",
        defaultTeamKey: "ENG",
      },
    },
  });
  assert.equal(patch.tasks?.linear?.enabled, true);
});
```

**Step 2: Run failing tests**

Run:

```bash
cd packages/contracts && bun run test src/settings.test.ts
```

Expected: FAIL because `tasks` does not exist.

**Step 3: Add settings schema**

In `packages/contracts/src/settings.ts`, near provider settings:

```ts
export const LinearTaskSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  apiToken: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  defaultTeamKey: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type LinearTaskSettings = typeof LinearTaskSettings.Type;
```

Add to `ServerSettings`:

```ts
tasks: Schema.Struct({
  linear: LinearTaskSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
}).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
```

Add patch schema:

```ts
const LinearTaskSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  apiToken: Schema.optionalKey(TrimmedString),
  defaultTeamKey: Schema.optionalKey(TrimmedString),
});
```

Add to `ServerSettingsPatch`:

```ts
tasks: Schema.optionalKey(
  Schema.Struct({
    linear: Schema.optionalKey(LinearTaskSettingsPatch),
  }),
),
```

**Step 4: Redact token for client**

In `apps/server/src/serverSettings.ts`, update `redactServerSettingsForClient`:

```ts
return {
  ...settings,
  providerInstances,
  tasks: {
    ...settings.tasks,
    linear: {
      ...settings.tasks.linear,
      apiToken: settings.tasks.linear.apiToken.length > 0 ? "" : "",
      ...(settings.tasks.linear.apiToken.length > 0 ? { apiTokenRedacted: true } : {}),
    },
  },
};
```

If this introduces a contract mismatch, add `apiTokenRedacted` to `LinearTaskSettings`; otherwise store redaction state only in UI by treating empty returned token plus enabled as configured. Prefer adding `apiTokenRedacted` if tests need it.

**Step 5: Verify**

Run:

```bash
cd packages/contracts && bun run test src/settings.test.ts
bun typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/contracts/src/settings.ts packages/contracts/src/settings.test.ts apps/server/src/serverSettings.ts
git commit -m "feat: add linear task settings"
```

## Task 3: Add TaskProvider Service and Registry

**Files:**

- Create: `apps/server/src/task/TaskProvider.ts`
- Create: `apps/server/src/task/TaskProviderRegistry.ts`
- Test: `apps/server/src/task/TaskProviderRegistry.test.ts`

**Step 1: Write registry tests**

Create `apps/server/src/task/TaskProviderRegistry.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { TaskProviderError } from "@t3tools/contracts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TaskProviderRegistry, makeWithProviders } from "./TaskProviderRegistry.ts";
import { TaskProvider } from "./TaskProvider.ts";

const fakeLinear = TaskProvider.of({
  kind: "linear",
  listTasks: () => Effect.succeed([]),
  getTask: () =>
    Effect.fail(
      new TaskProviderError({
        provider: "linear",
        operation: "getTask",
        detail: "not implemented",
      }),
    ),
  prepareTaskThread: () =>
    Effect.fail(
      new TaskProviderError({
        provider: "linear",
        operation: "prepareTaskThread",
        detail: "not implemented",
      }),
    ),
});

describe("TaskProviderRegistry", () => {
  it.effect("returns configured providers and discovery status", () =>
    Effect.gen(function* () {
      const registry = yield* TaskProviderRegistry;
      const provider = yield* registry.get("linear");
      assert.equal(provider.kind, "linear");
      const discovery = yield* registry.discover;
      assert.equal(discovery[0]?.kind, "linear");
      assert.equal(discovery[0]?.status, "available");
    }).pipe(
      Effect.provide(
        makeWithProviders([{ kind: "linear", provider: fakeLinear }]).pipe(
          Layer.provide(
            ServerSettingsService.layerTest({
              tasks: { linear: { enabled: true, apiToken: "lin_api_test", defaultTeamKey: "" } },
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("fails unknown providers", () =>
    Effect.gen(function* () {
      const registry = yield* TaskProviderRegistry;
      const exit = yield* Effect.exit(registry.get("jira"));
      assert.equal(exit._tag, "Failure");
    }).pipe(
      Effect.provide(makeWithProviders([]).pipe(Layer.provide(ServerSettingsService.layerTest()))),
    ),
  );
});
```

**Step 2: Run failing test**

Run:

```bash
cd apps/server && bun run test src/task/TaskProviderRegistry.test.ts
```

Expected: FAIL because task service files do not exist.

**Step 3: Implement provider interface**

Create `apps/server/src/task/TaskProvider.ts`:

```ts
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type {
  TaskItem,
  TaskListInput,
  TaskPrepareThreadInput,
  TaskPrepareThreadResult,
  TaskProviderError,
  TaskProviderKind,
  TaskReference,
} from "@t3tools/contracts";

export interface TaskProviderShape {
  readonly kind: TaskProviderKind;
  readonly listTasks: (
    input: Omit<TaskListInput, "provider">,
  ) => Effect.Effect<ReadonlyArray<TaskItem>, TaskProviderError>;
  readonly getTask: (input: {
    readonly reference: TaskReference;
    readonly cwd?: string;
  }) => Effect.Effect<TaskItem, TaskProviderError>;
  readonly prepareTaskThread: (
    input: Omit<TaskPrepareThreadInput, "provider">,
  ) => Effect.Effect<TaskPrepareThreadResult, TaskProviderError>;
}

export class TaskProvider extends Context.Service<TaskProvider, TaskProviderShape>()(
  "t3/task/TaskProvider",
) {}
```

**Step 4: Implement registry**

Create `apps/server/src/task/TaskProviderRegistry.ts`:

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  TaskProviderError,
  type TaskProviderDiscoveryItem,
  type TaskProviderKind,
} from "@t3tools/contracts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as TaskProvider from "./TaskProvider.ts";

export interface TaskProviderRegistration {
  readonly kind: TaskProviderKind;
  readonly provider: TaskProvider.TaskProviderShape;
}

export interface TaskProviderRegistryShape {
  readonly get: (
    kind: TaskProviderKind,
  ) => Effect.Effect<TaskProvider.TaskProviderShape, TaskProviderError>;
  readonly discover: Effect.Effect<ReadonlyArray<TaskProviderDiscoveryItem>>;
}

export class TaskProviderRegistry extends Context.Service<
  TaskProviderRegistry,
  TaskProviderRegistryShape
>()("t3/task/TaskProviderRegistry") {}

function unsupportedProvider(kind: TaskProviderKind): TaskProvider.TaskProviderShape {
  const unsupported = (operation: string) =>
    Effect.fail(
      new TaskProviderError({
        provider: kind,
        operation,
        detail: `No ${kind} task provider is registered.`,
      }),
    );
  return TaskProvider.TaskProvider.of({
    kind,
    listTasks: () => unsupported("listTasks"),
    getTask: () => unsupported("getTask"),
    prepareTaskThread: () => unsupported("prepareTaskThread"),
  });
}

export const makeWithProviders = (registrations: ReadonlyArray<TaskProviderRegistration>) =>
  Layer.effect(
    TaskProviderRegistry,
    Effect.gen(function* () {
      const settings = yield* ServerSettingsService;
      const providers = new Map<TaskProviderKind, TaskProvider.TaskProviderShape>(
        registrations.map((registration) => [registration.kind, registration.provider]),
      );

      return TaskProviderRegistry.of({
        get: (kind) => {
          const provider = providers.get(kind);
          return provider
            ? Effect.succeed(provider)
            : Effect.fail(
                new TaskProviderError({
                  provider: kind,
                  operation: "get",
                  detail: `No ${kind} task provider is registered.`,
                }),
              );
        },
        discover: settings.getSettings.pipe(
          Effect.map((current) => [
            {
              kind: "linear" as const,
              label: "Linear",
              status: !current.tasks.linear.enabled
                ? ("disabled" as const)
                : current.tasks.linear.apiToken.trim().length === 0
                  ? ("missing-token" as const)
                  : providers.has("linear")
                    ? ("available" as const)
                    : ("disabled" as const),
              detail: Option.none<string>(),
            },
          ]),
        ),
      });
    }),
  );
```

**Step 5: Verify**

Run:

```bash
cd apps/server && bun run test src/task/TaskProviderRegistry.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/server/src/task/TaskProvider.ts apps/server/src/task/TaskProviderRegistry.ts apps/server/src/task/TaskProviderRegistry.test.ts
git commit -m "feat: add task provider registry"
```

## Task 4: Implement Linear GraphQL Client and Provider Lookup

**Files:**

- Create: `apps/server/src/task/LinearTaskProvider.ts`
- Test: `apps/server/src/task/LinearTaskProvider.test.ts`

**Step 1: Write provider tests with mocked fetch**

Create `apps/server/src/task/LinearTaskProvider.test.ts` with a fake `fetch` injected into `makeTest`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ServerSettingsService } from "../serverSettings.ts";
import { makeTest, LinearTaskProvider } from "./LinearTaskProvider.ts";

describe("LinearTaskProvider", () => {
  it.effect("resolves ENG-123 into a provider-neutral task", () =>
    Effect.gen(function* () {
      const provider = yield* LinearTaskProvider;
      const task = yield* provider.getTask({ reference: "ENG-123" });
      assert.equal(task.provider, "linear");
      assert.equal(task.key, "ENG-123");
      assert.equal(task.title, "Fix startup");
      assert.equal(task.comments[0]?.bodyMarkdown, "Please fix this.");
    }).pipe(
      Effect.provide(
        makeTest({
          fetch: async () =>
            new Response(
              JSON.stringify({
                data: {
                  issue: {
                    id: "issue-id",
                    identifier: "ENG-123",
                    title: "Fix startup",
                    url: "https://linear.app/acme/issue/ENG-123/fix-startup",
                    state: { type: "started", name: "In Progress" },
                    assignee: { name: "Ada" },
                    labels: { nodes: [{ name: "bug" }] },
                    description: "Description body",
                    branchName: "eng-123-fix-startup",
                    updatedAt: "2026-06-01T00:00:00.000Z",
                    comments: {
                      nodes: [
                        {
                          id: "comment-1",
                          body: "Please fix this.",
                          user: { name: "Grace" },
                          createdAt: "2026-06-01T00:01:00.000Z",
                          updatedAt: "2026-06-01T00:01:00.000Z",
                        },
                      ],
                    },
                  },
                },
              }),
              { status: 200 },
            ),
        }).pipe(
          Layer.provide(
            ServerSettingsService.layerTest({
              tasks: { linear: { enabled: true, apiToken: "lin_api_test", defaultTeamKey: "" } },
            }),
          ),
        ),
      ),
    ),
  );
});
```

**Step 2: Run failing test**

Run:

```bash
cd apps/server && bun run test src/task/LinearTaskProvider.test.ts
```

Expected: FAIL because provider does not exist.

**Step 3: Implement minimal Linear provider**

Create `apps/server/src/task/LinearTaskProvider.ts`. Implement:

- `parseLinearReference(reference)` for `ENG-123`, URLs ending in `/issue/ENG-123/...`, and UUIDs.
- `linearGraphql(fetch, apiToken, query, variables)`.
- `toTaskItem(linearIssue)`.
- `makeWithFetch(fetchImpl)`.
- `makeTest({ fetch })`.

Use GraphQL query:

```graphql
query T3CodeIssue($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    url
    description
    branchName
    updatedAt
    state {
      type
      name
    }
    assignee {
      name
    }
    labels {
      nodes {
        name
      }
    }
    comments {
      nodes {
        id
        body
        createdAt
        updatedAt
        user {
          name
        }
      }
    }
  }
}
```

Map Linear states:

```ts
function mapLinearState(type: string | null | undefined): TaskState {
  switch (type) {
    case "started":
      return "in_progress";
    case "completed":
      return "done";
    case "canceled":
      return "canceled";
    case "unstarted":
    case "backlog":
      return "open";
    default:
      return "unknown";
  }
}
```

For missing token, fail with `TaskProviderError({ provider: "linear", operation: "...", detail: "Linear API token is not configured." })`.

**Step 4: Verify**

Run:

```bash
cd apps/server && bun run test src/task/LinearTaskProvider.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/task/LinearTaskProvider.ts apps/server/src/task/LinearTaskProvider.test.ts
git commit -m "feat: resolve linear tasks"
```

## Task 5: Prepare Linear Task Threads with Branch/Worktree

**Files:**

- Modify: `apps/server/src/task/LinearTaskProvider.ts`
- Test: `apps/server/src/task/LinearTaskProvider.test.ts`
- Potential helper extraction: `apps/server/src/git/taskBranch.ts`

**Step 1: Write failing branch/worktree tests**

Add tests:

```ts
it.effect("builds deterministic branch fallback when Linear has no branch name", () =>
  Effect.gen(function* () {
    const provider = yield* LinearTaskProvider;
    const result = yield* provider.prepareTaskThread({
      reference: "ENG-123",
      cwd: repoPath,
      mode: "local",
    });
    assert.equal(result.branch, "linear/eng-123-fix-startup");
    assert.match(result.initialPrompt, /ENG-123/);
    assert.match(result.initialPrompt, /Description body/);
  }),
);

it.effect("creates a worktree in worktree mode", () =>
  Effect.gen(function* () {
    const provider = yield* LinearTaskProvider;
    const result = yield* provider.prepareTaskThread({
      reference: "ENG-123",
      cwd: repoPath,
      mode: "worktree",
    });
    assert.equal(result.branch, "linear/eng-123-fix-startup");
    assert.ok(result.worktreePath);
  }),
);
```

Use an actual temporary git repository like `GitManager.test.ts` does. Reuse existing git helper patterns instead of shelling out ad hoc.

**Step 2: Run failing tests**

Run:

```bash
cd apps/server && bun run test src/task/LinearTaskProvider.test.ts
```

Expected: FAIL because `prepareTaskThread` is not implemented.

**Step 3: Implement task preparation**

Implement:

- Branch name:
  - Use `task.suggestedBranchName` if present.
  - Else `linear/${key.toLowerCase()}-${slug(title)}`.
  - Keep characters `[a-z0-9._/-]`; collapse duplicate separators; max 80 chars.
- Local mode:
  - Create or switch to branch using existing `GitVcsDriver`/`GitManager` helper if available.
  - Do not create a worktree.
- Worktree mode:
  - Reuse existing worktree if the branch is already checked out in a non-root worktree.
  - Fail if branch is checked out in root worktree.
  - Otherwise create worktree with existing VCS worktree method.
- Prompt:

```md
Use this task as source context. Verify against the repository before changing code.

# ENG-123: Fix startup

URL: https://linear.app/acme/issue/ENG-123/fix-startup
Status: In Progress
Assignee: Ada
Labels: bug

## Description

Description body

## Comments

### Grace

Please fix this.
```

**Step 4: Verify**

Run:

```bash
cd apps/server && bun run test src/task/LinearTaskProvider.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/task/LinearTaskProvider.ts apps/server/src/task/LinearTaskProvider.test.ts
git commit -m "feat: prepare linear task threads"
```

## Task 6: Wire Task RPC Endpoints

**Files:**

- Modify: `packages/contracts/src/rpc.ts`
- Modify: `packages/contracts/src/ipc.ts`
- Modify: `packages/client-runtime/src/wsRpcClient.ts`
- Modify: `apps/web/src/environmentApi.ts`
- Modify: `apps/server/src/ws.ts`
- Modify: `apps/server/src/server.ts`
- Test: `apps/server/src/server.test.ts`

**Step 1: Add failing RPC test**

In `apps/server/src/server.test.ts`, mirror existing `git.preparePullRequestThread` coverage and assert:

```ts
const result = await client[WS_METHODS.taskGetTask]({
  provider: "linear",
  reference: "ENG-123",
});
expect(result.task.key).toBe("ENG-123");
```

Use test layers to provide a fake `TaskProviderRegistry`.

**Step 2: Add RPC contracts**

In `packages/contracts/src/rpc.ts`:

```ts
taskListTasks: "task.listTasks",
taskGetTask: "task.getTask",
taskPrepareThread: "task.prepareThread",
```

Add `Rpc.make(...)` definitions using `TaskListInput`, `TaskListResult`, `TaskLookupInput`, `TaskPrepareThreadInput`, `TaskPrepareThreadResult`, and `TaskProviderError`.

Add all three to `WsRpcGroup`.

In `packages/contracts/src/ipc.ts`, add to `EnvironmentApi`:

```ts
task: {
  listTasks: (input: TaskListInput) => Promise<TaskListResult>;
  getTask: (input: TaskLookupInput) => Promise<{ task: TaskItem }>;
  prepareThread: (input: TaskPrepareThreadInput) => Promise<TaskPrepareThreadResult>;
}
```

**Step 3: Wire client runtime**

In `packages/client-runtime/src/wsRpcClient.ts`, add:

```ts
readonly task: {
  readonly listTasks: RpcUnaryMethod<typeof WS_METHODS.taskListTasks>;
  readonly getTask: RpcUnaryMethod<typeof WS_METHODS.taskGetTask>;
  readonly prepareThread: RpcUnaryMethod<typeof WS_METHODS.taskPrepareThread>;
};
```

And implementation:

```ts
task: {
  listTasks: (input) => transport.request((client) => client[WS_METHODS.taskListTasks](input)),
  getTask: (input) => transport.request((client) => client[WS_METHODS.taskGetTask](input)),
  prepareThread: (input) => transport.request((client) => client[WS_METHODS.taskPrepareThread](input)),
},
```

In `apps/web/src/environmentApi.ts`, expose `task`.

**Step 4: Wire server RPC**

In `apps/server/src/ws.ts`, require `TaskProviderRegistry`, route methods through auth scopes equivalent to PR prepare:

- `task.listTasks`: read scope
- `task.getTask`: read scope
- `task.prepareThread`: operate scope

Handlers:

```ts
[WS_METHODS.taskGetTask]: (input) =>
  runAuthenticatedRpc(
    WS_METHODS.taskGetTask,
    TaskProviderRegistry.pipe(
      Effect.flatMap((registry) => registry.get(input.provider)),
      Effect.flatMap((provider) => provider.getTask(input)),
      Effect.map((task) => ({ task })),
    ),
  )
```

Wire `TaskProviderRegistry.layer` in `apps/server/src/server.ts`, providing `LinearTaskProvider.layer`, `GitVcsDriver.layer`, and settings.

**Step 5: Verify**

Run:

```bash
bun typecheck
cd apps/server && bun run test src/server.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/contracts/src/rpc.ts packages/contracts/src/ipc.ts packages/client-runtime/src/wsRpcClient.ts apps/web/src/environmentApi.ts apps/server/src/ws.ts apps/server/src/server.ts apps/server/src/server.test.ts
git commit -m "feat: expose task provider rpc"
```

## Task 7: Add Linear Settings UI

**Files:**

- Modify: `apps/web/src/components/settings/SourceControlSettings.tsx` or create `apps/web/src/components/settings/TaskProviderSettings.tsx`
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx`
- Test: `apps/web/src/components/settings/SettingsPanels.logic.test.ts` or new focused test

**Step 1: Write failing UI logic test**

Test that settings patch for Linear token preserves redacted token unless changed.

**Step 2: Implement minimal UI**

Add a “Task providers” section under Source Control settings:

- Linear row.
- Enable switch.
- API token password input.
- Default team key text input.
- Save through `useUpdateSettings`.

Do not add OAuth, workspace picker, or token validation in v1.

**Step 3: Verify**

Run:

```bash
bun typecheck
bun lint
cd apps/web && bun run test src/components/settings/SettingsPanels.logic.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/src/components/settings/SourceControlSettings.tsx apps/web/src/components/settings/SettingsPanels.tsx
git commit -m "feat: add linear task settings ui"
```

## Task 8: Add Linear Task Dialog

**Files:**

- Create: `apps/web/src/components/TaskThreadDialog.tsx`
- Create: `apps/web/src/lib/taskActions.ts`
- Modify: `apps/web/src/components/CommandPalette.tsx`
- Test: `apps/web/src/components/ChatView.browser.tsx` or a new browser test if there is a smaller harness

**Step 1: Write failing browser test**

Add a test that:

1. Opens command palette.
2. Runs “Checkout Linear issue”.
3. Enters `ENG-123`.
4. Sees resolved title.
5. Clicks “Worktree”.
6. Asserts `task.prepareThread` RPC was called.
7. Asserts draft prompt contains `ENG-123`.

**Step 2: Implement task actions**

Create `apps/web/src/lib/taskActions.ts` mirroring the PR resolution hook shape:

- `useTaskResolution({ environmentId, cwd, provider, reference })`
- `readCachedTaskResolution`
- `usePrepareTaskThreadAction(scope)`

**Step 3: Implement dialog**

Create `TaskThreadDialog.tsx` by adapting `PullRequestThreadDialog.tsx`:

- Title: `Checkout Linear issue`.
- Input accepts `ENG-123` or Linear URL.
- Resolves via `task.getTask`.
- Shows key/title/status.
- Footer buttons: `Local`, `Worktree`.
- On prepare, calls `task.prepareThread`.
- Calls `onPrepared({ branch, worktreePath, initialPrompt })`.

**Step 4: Hook into CommandPalette**

Add root command item:

```tsx
{
  kind: "action",
  value: "action:checkout-linear-issue",
  searchTerms: ["linear", "issue", "task", "worktree"],
  title: "Checkout Linear issue",
  icon: <TicketIcon className={ITEM_ICON_CLASS} />,
  run: async () => setLinearTaskDialogOpen(true),
}
```

When prepared:

- Create or update draft thread using existing `handleNewThread` flow.
- Apply branch/worktree metadata.
- Set composer prompt to `initialPrompt`.

If setting composer prompt is not currently exposed, add the smallest hook to create the draft with initial prompt rather than mutating after navigation.

**Step 5: Verify**

Run:

```bash
cd apps/web && bun run test:browser -- src/components/ChatView.browser.tsx
bun typecheck
bun lint
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/src/components/TaskThreadDialog.tsx apps/web/src/lib/taskActions.ts apps/web/src/components/CommandPalette.tsx apps/web/src/components/ChatView.browser.tsx
git commit -m "feat: start threads from linear issues"
```

## Task 9: Final Verification

**Files:**

- Update docs if needed: `docs/source-control-providers.md` or new `docs/task-providers.md`

**Step 1: Run required checks**

Run from repo root:

```bash
bun fmt
bun lint
bun typecheck
```

Expected: all pass. `bun lint` may print existing warnings, but must exit 0.

**Step 2: Run targeted tests**

Run:

```bash
cd packages/contracts && bun run test src/task.test.ts src/settings.test.ts
cd apps/server && bun run test src/task/TaskProviderRegistry.test.ts src/task/LinearTaskProvider.test.ts
cd apps/web && bun run test:browser -- src/components/ChatView.browser.tsx
```

Expected: all pass.

**Step 3: Manual smoke**

Run app locally and test:

1. Add Linear token in Settings.
2. Open command palette.
3. Checkout Linear issue `ENG-123`.
4. Prepare local branch.
5. Prepare worktree branch.
6. Confirm draft prompt contains issue title, URL, description, and comments.

**Step 4: Final commit**

```bash
git status --short
git log --oneline -5
```

Confirm only intended files are changed and commits are clean.
