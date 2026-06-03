# Linear Issue Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a provider-neutral issue integration layer, with Linear as the first provider, so users can associate issues with T3 Code projects, start a thread/worktree from an issue, and update the issue lifecycle when a PR is opened or merged.

**Architecture:** Build `IssueProvider` as a sibling to `SourceControlProvider`, not as a source-control subtype. Contracts stay schema-only in `packages/contracts`; server runtime owns provider implementations, settings, auth, issue-to-project association, issue preparation, and issue lifecycle updates; web consumes provider-neutral issue RPCs and renders Linear-first UI. V1 uses a server-side Linear API token and delegates branch/worktree creation to existing VCS/Git worktree paths.

**Association model:** Every issue lookup/list is scoped to the active T3 Code project via `cwd` and, where available, `repositoryIdentity`. GitHub Issues derives its issue source from the GitHub repository attached to that project. Linear cannot derive this from git, so settings store a `issues.linear.projectMappings` map keyed by T3 `ProjectId`; each entry points at a Linear project plus optional team key. `IssuePrepareThreadResult` can return the resolved association so the UI and future status-sync code have the same source of truth.

**Lifecycle model:** Issue providers expose `updateIssueLifecycle`. T3 calls it when an issue thread starts, when a change request is opened, and when a change request is merged. Linear maps those events to configured workflow states and/or linked PR metadata; GitHub Issues can derive the association from the repo and close/update the issue in the same repository. The first implementation can no-op unsupported transitions, but the provider contract must preserve the event and change-request metadata.

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

## Task 1: Add Issue Contracts

**Files:**

- Create: `packages/contracts/src/issue.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/issue.test.ts`

**Step 1: Write failing schema tests**

Create `packages/contracts/src/issue.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import * as Schema from "effect/Schema";
import { IssueItem, IssuePrepareThreadResult, IssueProviderKind, IssueReference } from "./issue.ts";

describe("issue contracts", () => {
  it("decodes provider kinds", () => {
    assert.equal(Schema.decodeSync(IssueProviderKind)("linear"), "linear");
  });

  it("decodes a minimal issue item", () => {
    const issue = Schema.decodeSync(IssueItem)({
      provider: "linear",
      id: "issue-id",
      key: "ENG-123",
      title: "Fix startup",
      url: "https://linear.app/acme/issue/ENG-123/fix-startup",
      state: "open",
      labels: [],
      comments: [],
    });

    assert.equal(issue.key, "ENG-123");
    assert.equal(issue.comments.length, 0);
  });

  it("decodes issue references and prepare results", () => {
    assert.equal(Schema.decodeSync(IssueReference)("ENG-123"), "ENG-123");
    const result = Schema.decodeSync(IssuePrepareThreadResult)({
      issue: {
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
      initialPrompt: "Issue context...",
    });

    assert.equal(result.branch, "linear/eng-123-fix-startup");
  });
});
```

**Step 2: Run failing tests**

Run:

```bash
cd packages/contracts && bun run test src/issue.test.ts
```

Expected: FAIL because `issue.ts` does not exist.

**Step 3: Add contracts**

Create `packages/contracts/src/issue.ts`:

```ts
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString, PositiveInt } from "./baseSchemas.ts";
import { ThreadId } from "./orchestration.ts";

export const IssueProviderKind = Schema.Literals(["linear", "github-issues", "jira", "unknown"]);
export type IssueProviderKind = typeof IssueProviderKind.Type;

export const IssueState = Schema.Literals(["open", "in_progress", "done", "canceled", "unknown"]);
export type IssueState = typeof IssueState.Type;

export const IssueComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  authorName: Schema.Option(TrimmedNonEmptyString),
  bodyMarkdown: TrimmedNonEmptyString,
  createdAt: Schema.Option(Schema.DateTimeUtc),
  updatedAt: Schema.Option(Schema.DateTimeUtc),
});
export type IssueComment = typeof IssueComment.Type;

export const IssueItem = Schema.Struct({
  provider: IssueProviderKind,
  id: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  state: IssueState,
  statusName: Schema.optional(TrimmedNonEmptyString),
  assigneeName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  labels: Schema.Array(TrimmedNonEmptyString),
  comments: Schema.Array(IssueComment),
  descriptionMarkdown: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  suggestedBranchName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: Schema.optional(Schema.DateTimeUtc),
});
export type IssueItem = typeof IssueItem.Type;

export const IssueReference = TrimmedNonEmptyString;
export type IssueReference = typeof IssueReference.Type;

export const IssueLookupInput = Schema.Struct({
  provider: IssueProviderKind,
  reference: IssueReference,
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type IssueLookupInput = typeof IssueLookupInput.Type;

export const IssueListInput = Schema.Struct({
  provider: IssueProviderKind,
  query: Schema.optional(Schema.String),
  cwd: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt),
});
export type IssueListInput = typeof IssueListInput.Type;

export const IssueListResult = Schema.Struct({
  issues: Schema.Array(IssueItem),
});
export type IssueListResult = typeof IssueListResult.Type;

export const LinearIssueProjectAssociation = Schema.Struct({
  projectId: TrimmedNonEmptyString,
  projectName: Schema.optional(TrimmedNonEmptyString),
  teamKey: Schema.optional(TrimmedNonEmptyString),
});

export const GitHubIssueProjectAssociation = Schema.Struct({
  repository: TrimmedNonEmptyString,
});

export const IssueProjectAssociation = Schema.Struct({
  provider: IssueProviderKind,
  projectId: ProjectId,
  repositoryKey: TrimmedNonEmptyString,
  linear: Schema.optional(LinearIssueProjectAssociation),
  github: Schema.optional(GitHubIssueProjectAssociation),
});

export const IssuePrepareMode = Schema.Literals(["local", "worktree"]);
export type IssuePrepareMode = typeof IssuePrepareMode.Type;

export const IssuePrepareThreadInput = Schema.Struct({
  provider: IssueProviderKind,
  reference: IssueReference,
  cwd: TrimmedNonEmptyString,
  mode: IssuePrepareMode,
  threadId: Schema.optional(ThreadId),
});
export type IssuePrepareThreadInput = typeof IssuePrepareThreadInput.Type;

export const IssuePrepareThreadResult = Schema.Struct({
  issue: IssueItem,
  association: Schema.optional(IssueProjectAssociation),
  branch: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  initialPrompt: TrimmedNonEmptyString,
});
export type IssuePrepareThreadResult = typeof IssuePrepareThreadResult.Type;

export const IssueLifecycleEvent = Schema.Literals([
  "thread_started",
  "change_request_opened",
  "change_request_merged",
]);

export const IssueLifecycleChangeRequest = Schema.Struct({
  provider: SourceControlProviderKind,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: Schema.String,
  state: ChangeRequestState,
});

export const IssueLifecycleUpdateInput = Schema.Struct({
  provider: IssueProviderKind,
  reference: IssueReference,
  cwd: TrimmedNonEmptyString,
  event: IssueLifecycleEvent,
  changeRequest: Schema.optional(IssueLifecycleChangeRequest),
});

export const IssueLifecycleUpdateResult = Schema.Struct({
  issue: Schema.optional(IssueItem),
  statusChanged: Schema.Boolean,
  previousStatusName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  nextStatusName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

export const IssueProviderDiscoveryStatus = Schema.Literals([
  "available",
  "missing-token",
  "disabled",
]);
export type IssueProviderDiscoveryStatus = typeof IssueProviderDiscoveryStatus.Type;

export const IssueProviderDiscoveryItem = Schema.Struct({
  kind: IssueProviderKind,
  label: TrimmedNonEmptyString,
  status: IssueProviderDiscoveryStatus,
  detail: Schema.Option(TrimmedNonEmptyString),
});
export type IssueProviderDiscoveryItem = typeof IssueProviderDiscoveryItem.Type;

export class IssueProviderError extends Schema.TaggedErrorClass<IssueProviderError>()(
  "IssueProviderError",
  {
    provider: IssueProviderKind,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Issue provider ${this.provider} failed in ${this.operation}: ${this.detail}`;
  }
}
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./issue.ts";
```

**Step 4: Verify tests pass**

Run:

```bash
cd packages/contracts && bun run test src/issue.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/contracts/src/issue.ts packages/contracts/src/issue.test.ts packages/contracts/src/index.ts
git commit -m "feat: add issue provider contracts"
```

## Task 2: Add Linear Settings

**Files:**

- Modify: `packages/contracts/src/settings.ts`
- Test: `packages/contracts/src/settings.test.ts`
- Modify if needed: `apps/server/src/serverSettings.ts`

**Step 1: Write failing settings tests**

In `packages/contracts/src/settings.test.ts`, add tests that decode defaults and patches:

```ts
it("defaults Linear issue settings to disabled with no API token", () => {
  const settings = Schema.decodeSync(ServerSettings)({});
  assert.equal(settings.issues.linear.enabled, false);
  assert.equal(settings.issues.linear.apiToken, "");
});

it("accepts Linear issue settings patches", () => {
  const patch = Schema.decodeSync(ServerSettingsPatch)({
    issues: {
      linear: {
        enabled: true,
        apiToken: "lin_api_test",
        defaultTeamKey: "ENG",
      },
    },
  });
  assert.equal(patch.issues?.linear?.enabled, true);
});
```

**Step 2: Run failing tests**

Run:

```bash
cd packages/contracts && bun run test src/settings.test.ts
```

Expected: FAIL because `issues` does not exist.

**Step 3: Add settings schema**

In `packages/contracts/src/settings.ts`, near provider settings:

```ts
export const LinearIssueSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  apiToken: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  defaultTeamKey: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  projectMappings: Schema.Record(
    ProjectId,
    Schema.Struct({
      linearProjectId: TrimmedString,
      linearProjectName: TrimmedString,
      teamKey: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
    }),
  ).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type LinearIssueSettings = typeof LinearIssueSettings.Type;
```

Add to `ServerSettings`:

```ts
issues: Schema.Struct({
  linear: LinearIssueSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
}).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
```

Add patch schema:

```ts
const LinearIssueSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  apiToken: Schema.optionalKey(TrimmedString),
  defaultTeamKey: Schema.optionalKey(TrimmedString),
  projectMappings: Schema.optionalKey(
    Schema.Record(
      ProjectId,
      Schema.Struct({
        linearProjectId: TrimmedString,
        linearProjectName: TrimmedString,
        teamKey: Schema.optionalKey(TrimmedString),
      }),
    ),
  ),
});
```

Add to `ServerSettingsPatch`:

```ts
issues: Schema.optionalKey(
  Schema.Struct({
    linear: Schema.optionalKey(LinearIssueSettingsPatch),
  }),
),
```

**Step 4: Redact token for client**

In `apps/server/src/serverSettings.ts`, update `redactServerSettingsForClient`:

```ts
return {
  ...settings,
  providerInstances,
  issues: {
    ...settings.issues,
    linear: {
      ...settings.issues.linear,
      apiToken: settings.issues.linear.apiToken.length > 0 ? "" : "",
      ...(settings.issues.linear.apiToken.length > 0 ? { apiTokenRedacted: true } : {}),
    },
  },
};
```

If this introduces a contract mismatch, add `apiTokenRedacted` to `LinearIssueSettings`; otherwise store redaction state only in UI by treating empty returned token plus enabled as configured. Prefer adding `apiTokenRedacted` if tests need it.

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
git commit -m "feat: add linear issue settings"
```

## Task 3: Add IssueProvider Service and Registry

**Files:**

- Create: `apps/server/src/issue/IssueProvider.ts`
- Create: `apps/server/src/issue/IssueProviderRegistry.ts`
- Test: `apps/server/src/issue/IssueProviderRegistry.test.ts`

**Step 1: Write registry tests**

Create `apps/server/src/issue/IssueProviderRegistry.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { IssueProviderError } from "@t3tools/contracts";
import { ServerSettingsService } from "../serverSettings.ts";
import { IssueProviderRegistry, makeWithProviders } from "./IssueProviderRegistry.ts";
import { IssueProvider } from "./IssueProvider.ts";

const fakeLinear = IssueProvider.of({
  kind: "linear",
  listIssues: () => Effect.succeed([]),
  getIssue: () =>
    Effect.fail(
      new IssueProviderError({
        provider: "linear",
        operation: "getIssue",
        detail: "not implemented",
      }),
    ),
  prepareIssueThread: () =>
    Effect.fail(
      new IssueProviderError({
        provider: "linear",
        operation: "prepareIssueThread",
        detail: "not implemented",
      }),
    ),
});

describe("IssueProviderRegistry", () => {
  it.effect("returns configured providers and discovery status", () =>
    Effect.gen(function* () {
      const registry = yield* IssueProviderRegistry;
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
              issues: { linear: { enabled: true, apiToken: "lin_api_test", defaultTeamKey: "" } },
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("fails unknown providers", () =>
    Effect.gen(function* () {
      const registry = yield* IssueProviderRegistry;
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
cd apps/server && bun run test src/issue/IssueProviderRegistry.test.ts
```

Expected: FAIL because issue service files do not exist.

**Step 3: Implement provider interface**

Create `apps/server/src/issue/IssueProvider.ts`:

```ts
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type {
  IssueItem,
  IssueListInput,
  IssuePrepareThreadInput,
  IssuePrepareThreadResult,
  IssueProviderError,
  IssueProviderKind,
  IssueReference,
} from "@t3tools/contracts";

export interface IssueProviderShape {
  readonly kind: IssueProviderKind;
  readonly listIssues: (
    input: Omit<IssueListInput, "provider">,
  ) => Effect.Effect<ReadonlyArray<IssueItem>, IssueProviderError>;
  readonly getIssue: (input: {
    readonly reference: IssueReference;
    readonly cwd?: string;
  }) => Effect.Effect<IssueItem, IssueProviderError>;
  readonly prepareIssueThread: (
    input: Omit<IssuePrepareThreadInput, "provider">,
  ) => Effect.Effect<IssuePrepareThreadResult, IssueProviderError>;
  readonly updateIssueLifecycle: (
    input: Omit<IssueLifecycleUpdateInput, "provider">,
  ) => Effect.Effect<IssueLifecycleUpdateResult, IssueProviderError>;
}

export class IssueProvider extends Context.Service<IssueProvider, IssueProviderShape>()(
  "t3/issue/IssueProvider",
) {}
```

**Step 4: Implement registry**

Create `apps/server/src/issue/IssueProviderRegistry.ts`:

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  IssueProviderError,
  type IssueProviderDiscoveryItem,
  type IssueProviderKind,
} from "@t3tools/contracts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as IssueProvider from "./IssueProvider.ts";

export interface IssueProviderRegistration {
  readonly kind: IssueProviderKind;
  readonly provider: IssueProvider.IssueProviderShape;
}

export interface IssueProviderRegistryShape {
  readonly get: (
    kind: IssueProviderKind,
  ) => Effect.Effect<IssueProvider.IssueProviderShape, IssueProviderError>;
  readonly discover: Effect.Effect<ReadonlyArray<IssueProviderDiscoveryItem>>;
}

export class IssueProviderRegistry extends Context.Service<
  IssueProviderRegistry,
  IssueProviderRegistryShape
>()("t3/issue/IssueProviderRegistry") {}

function unsupportedProvider(kind: IssueProviderKind): IssueProvider.IssueProviderShape {
  const unsupported = (operation: string) =>
    Effect.fail(
      new IssueProviderError({
        provider: kind,
        operation,
        detail: `No ${kind} issue provider is registered.`,
      }),
    );
  return IssueProvider.IssueProvider.of({
    kind,
    listIssues: () => unsupported("listIssues"),
    getIssue: () => unsupported("getIssue"),
    prepareIssueThread: () => unsupported("prepareIssueThread"),
    updateIssueLifecycle: () => unsupported("updateIssueLifecycle"),
  });
}

export const makeWithProviders = (registrations: ReadonlyArray<IssueProviderRegistration>) =>
  Layer.effect(
    IssueProviderRegistry,
    Effect.gen(function* () {
      const settings = yield* ServerSettingsService;
      const providers = new Map<IssueProviderKind, IssueProvider.IssueProviderShape>(
        registrations.map((registration) => [registration.kind, registration.provider]),
      );

      return IssueProviderRegistry.of({
        get: (kind) => {
          const provider = providers.get(kind);
          return provider
            ? Effect.succeed(provider)
            : Effect.fail(
                new IssueProviderError({
                  provider: kind,
                  operation: "get",
                  detail: `No ${kind} issue provider is registered.`,
                }),
              );
        },
        discover: settings.getSettings.pipe(
          Effect.map((current) => [
            {
              kind: "linear" as const,
              label: "Linear",
              status: !current.issues.linear.enabled
                ? ("disabled" as const)
                : current.issues.linear.apiToken.trim().length === 0
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
cd apps/server && bun run test src/issue/IssueProviderRegistry.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/server/src/issue/IssueProvider.ts apps/server/src/issue/IssueProviderRegistry.ts apps/server/src/issue/IssueProviderRegistry.test.ts
git commit -m "feat: add issue provider registry"
```

## Task 4: Implement Linear GraphQL Client and Provider Lookup

**Files:**

- Create: `apps/server/src/issue/LinearIssueProvider.ts`
- Test: `apps/server/src/issue/LinearIssueProvider.test.ts`

**Step 1: Write provider tests with mocked fetch**

Create `apps/server/src/issue/LinearIssueProvider.test.ts` with a fake `fetch` injected into `makeTest`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ServerSettingsService } from "../serverSettings.ts";
import { makeTest, LinearIssueProvider } from "./LinearIssueProvider.ts";

describe("LinearIssueProvider", () => {
  it.effect("resolves ENG-123 into a provider-neutral issue", () =>
    Effect.gen(function* () {
      const provider = yield* LinearIssueProvider;
      const issue = yield* provider.getIssue({ reference: "ENG-123" });
      assert.equal(issue.provider, "linear");
      assert.equal(issue.key, "ENG-123");
      assert.equal(issue.title, "Fix startup");
      assert.equal(issue.comments[0]?.bodyMarkdown, "Please fix this.");
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
              issues: { linear: { enabled: true, apiToken: "lin_api_test", defaultTeamKey: "" } },
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
cd apps/server && bun run test src/issue/LinearIssueProvider.test.ts
```

Expected: FAIL because provider does not exist.

**Step 3: Implement minimal Linear provider**

Create `apps/server/src/issue/LinearIssueProvider.ts`. Implement:

- `parseLinearReference(reference)` for `ENG-123`, URLs ending in `/issue/ENG-123/...`, and UUIDs.
- `linearGraphql(fetch, apiToken, query, variables)`.
- `toIssueItem(linearIssue)`.
- `resolveLinearAssociation({ projectId, cwd })`:
  - Prefer `settings.issues.linear.projectMappings[projectId]` when a project id is available.
  - Fall back to `defaultTeamKey` only for direct lookup by issue key.
  - Return an `IssueProjectAssociation` in prepare/list responses when a mapping is found.
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
function mapLinearState(type: string | null | undefined): IssueState {
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

For missing token, fail with `IssueProviderError({ provider: "linear", operation: "...", detail: "Linear API token is not configured." })`.

When listing issues for a T3 project, include a Linear `project(id: ...)` filter if the project has a mapping. Do not show unrelated workspace-wide Linear issues in project-scoped flows.

**Step 4: Verify**

Run:

```bash
cd apps/server && bun run test src/issue/LinearIssueProvider.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/issue/LinearIssueProvider.ts apps/server/src/issue/LinearIssueProvider.test.ts
git commit -m "feat: resolve linear issues"
```

## Task 5: Prepare Linear Issue Threads with Branch/Worktree

**Files:**

- Modify: `apps/server/src/issue/LinearIssueProvider.ts`
- Test: `apps/server/src/issue/LinearIssueProvider.test.ts`
- Potential helper extraction: `apps/server/src/git/issueBranch.ts`

**Step 1: Write failing branch/worktree tests**

Add tests:

```ts
it.effect("builds deterministic branch fallback when Linear has no branch name", () =>
  Effect.gen(function* () {
    const provider = yield* LinearIssueProvider;
    const result = yield* provider.prepareIssueThread({
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
    const provider = yield* LinearIssueProvider;
    const result = yield* provider.prepareIssueThread({
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
cd apps/server && bun run test src/issue/LinearIssueProvider.test.ts
```

Expected: FAIL because `prepareIssueThread` is not implemented.

**Step 3: Implement issue preparation**

Implement:

- Resolve the T3 project association first. For Linear, attach the mapped Linear project/team metadata to `IssuePrepareThreadResult.association`.
- Branch name:
  - Use `issue.suggestedBranchName` if present.
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
Use this issue as source context. Verify against the repository before changing code.

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
cd apps/server && bun run test src/issue/LinearIssueProvider.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/issue/LinearIssueProvider.ts apps/server/src/issue/LinearIssueProvider.test.ts
git commit -m "feat: prepare linear issue threads"
```

## Task 6: Wire Issue RPC Endpoints

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
const result = await client[WS_METHODS.issueGetIssue]({
  provider: "linear",
  reference: "ENG-123",
});
expect(result.issue.key).toBe("ENG-123");
```

Use test layers to provide a fake `IssueProviderRegistry`.

**Step 2: Add RPC contracts**

In `packages/contracts/src/rpc.ts`:

```ts
issueListIssues: "issue.listIssues",
issueGetIssue: "issue.getIssue",
issuePrepareThread: "issue.prepareThread",
issueUpdateLifecycle: "issue.updateLifecycle",
```

Add `Rpc.make(...)` definitions using `IssueListInput`, `IssueListResult`, `IssueLookupInput`, `IssuePrepareThreadInput`, `IssuePrepareThreadResult`, `IssueLifecycleUpdateInput`, `IssueLifecycleUpdateResult`, and `IssueProviderError`.

Add all three to `WsRpcGroup`.

In `packages/contracts/src/ipc.ts`, add to `EnvironmentApi`:

```ts
issue: {
  listIssues: (input: IssueListInput) => Promise<IssueListResult>;
  getIssue: (input: IssueLookupInput) => Promise<{ issue: IssueItem }>;
  prepareThread: (input: IssuePrepareThreadInput) => Promise<IssuePrepareThreadResult>;
  updateLifecycle: (input: IssueLifecycleUpdateInput) => Promise<IssueLifecycleUpdateResult>;
}
```

**Step 3: Wire client runtime**

In `packages/client-runtime/src/wsRpcClient.ts`, add:

```ts
readonly issue: {
  readonly listIssues: RpcUnaryMethod<typeof WS_METHODS.issueListIssues>;
  readonly getIssue: RpcUnaryMethod<typeof WS_METHODS.issueGetIssue>;
  readonly prepareThread: RpcUnaryMethod<typeof WS_METHODS.issuePrepareThread>;
};
```

And implementation:

```ts
issue: {
  listIssues: (input) => transport.request((client) => client[WS_METHODS.issueListIssues](input)),
  getIssue: (input) => transport.request((client) => client[WS_METHODS.issueGetIssue](input)),
  prepareThread: (input) => transport.request((client) => client[WS_METHODS.issuePrepareThread](input)),
  updateLifecycle: (input) => transport.request((client) => client[WS_METHODS.issueUpdateLifecycle](input)),
},
```

In `apps/web/src/environmentApi.ts`, expose `issue`.

**Step 4: Wire server RPC**

In `apps/server/src/ws.ts`, require `IssueProviderRegistry`, route methods through auth scopes equivalent to PR prepare:

- `issue.listIssues`: read scope
- `issue.getIssue`: read scope
- `issue.prepareThread`: operate scope
- `issue.updateLifecycle`: operate scope

Handlers:

```ts
[WS_METHODS.issueGetIssue]: (input) =>
  runAuthenticatedRpc(
    WS_METHODS.issueGetIssue,
    IssueProviderRegistry.pipe(
      Effect.flatMap((registry) => registry.get(input.provider)),
      Effect.flatMap((provider) => provider.getIssue(input)),
      Effect.map((issue) => ({ issue })),
    ),
  )
```

Wire `IssueProviderRegistry.layer` in `apps/server/src/server.ts`, providing `LinearIssueProvider.layer`, `GitVcsDriver.layer`, and settings.

After `git.runStackedAction` returns a PR with status `created` or `opened_existing`, call `issue.updateLifecycle` with `event: "change_request_opened"` when the active thread was created from an issue. When source-control status later reports the associated PR as merged, call `issue.updateLifecycle` with `event: "change_request_merged"`. Persisting the thread-to-issue association can be a lightweight thread metadata field or a projection table, but it must key by provider/reference plus project association.

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
git commit -m "feat: expose issue provider rpc"
```

## Task 7: Add Linear Settings UI

**Files:**

- Modify: `apps/web/src/components/settings/SourceControlSettings.tsx` or create `apps/web/src/components/settings/IssueProviderSettings.tsx`
- Modify: `apps/web/src/components/settings/SettingsPanels.tsx`
- Test: `apps/web/src/components/settings/SettingsPanels.logic.test.ts` or new focused test

**Step 1: Write failing UI logic test**

Test that settings patch for Linear token preserves redacted token unless changed.

**Step 2: Implement minimal UI**

Add a “Issue providers” section under Source Control settings:

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
git commit -m "feat: add linear issue settings ui"
```

## Task 8: Add Linear Issue Dialog

**Files:**

- Create: `apps/web/src/components/IssueThreadDialog.tsx`
- Create: `apps/web/src/lib/issueActions.ts`
- Modify: `apps/web/src/components/CommandPalette.tsx`
- Test: `apps/web/src/components/ChatView.browser.tsx` or a new browser test if there is a smaller harness

**Step 1: Write failing browser test**

Add a test that:

1. Opens command palette.
2. Runs “Checkout Linear issue”.
3. Enters `ENG-123`.
4. Sees resolved title.
5. Clicks “Worktree”.
6. Asserts `issue.prepareThread` RPC was called.
7. Asserts draft prompt contains `ENG-123`.

**Step 2: Implement issue actions**

Create `apps/web/src/lib/issueActions.ts` mirroring the PR resolution hook shape:

- `useIssueResolution({ environmentId, cwd, provider, reference })`
- `readCachedIssueResolution`
- `usePrepareIssueThreadAction(scope)`

**Step 3: Implement dialog**

Create `IssueThreadDialog.tsx` by adapting `PullRequestThreadDialog.tsx`:

- Title: `Checkout Linear issue`.
- Input accepts `ENG-123` or Linear URL.
- Resolves via `issue.getIssue`.
- Shows key/title/status.
- Footer buttons: `Local`, `Worktree`.
- On prepare, calls `issue.prepareThread`.
- Calls `onPrepared({ branch, worktreePath, initialPrompt })`.

**Step 4: Hook into CommandPalette**

Add root command item:

```tsx
{
  kind: "action",
  value: "action:checkout-linear-issue",
  searchTerms: ["linear", "issue", "issue", "worktree"],
  title: "Checkout Linear issue",
  icon: <TicketIcon className={ITEM_ICON_CLASS} />,
  run: async () => setLinearIssueDialogOpen(true),
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
git add apps/web/src/components/IssueThreadDialog.tsx apps/web/src/lib/issueActions.ts apps/web/src/components/CommandPalette.tsx apps/web/src/components/ChatView.browser.tsx
git commit -m "feat: start threads from linear issues"
```

## Task 9: Final Verification

**Files:**

- Update docs if needed: `docs/source-control-providers.md` or new `docs/issue-providers.md`

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
cd packages/contracts && bun run test src/issue.test.ts src/settings.test.ts
cd apps/server && bun run test src/issue/IssueProviderRegistry.test.ts src/issue/LinearIssueProvider.test.ts
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
