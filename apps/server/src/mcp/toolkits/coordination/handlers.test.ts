import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  ProjectId,
  RunId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";
import * as Bob from "../../../coordination/BobCoordination.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";

const caller = {
  id: ThreadId.make("thread"),
  projectId: ProjectId.make("project"),
  deletedAt: null,
  archivedAt: null,
  activeRunId: RunId.make("run"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeMode: "full-access",
  interactionMode: "default",
} as OrchestrationV2ThreadShell;
const target = {
  environmentId: "mini",
  projectId: "project",
  repository: { integrationId: "forgegraph", repositoryId: "repo" },
};
const issueProject = {
  integrationId: "kanbanger",
  workspaceId: "workspace",
  teamId: "team",
  projectId: "issues",
};
const scope: Invocation.McpInvocationScope = {
  environmentId: EnvironmentId.make("mini"),
  thread: {
    threadId: caller.id,
    providerSessionId: "session",
    providerInstanceId: caller.providerInstanceId,
  },
  client: undefined,
  requestNamespace: "thread:thread",
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

// Returned tool failures arrive as error text content, not structured content.
const failureOf = (result: McpSchema.CallToolResult): unknown => {
  expect(result.isError).toBe(true);
  const [first] = result.content;
  return first?.type === "text" ? JSON.parse(first.text) : undefined;
};

it.effect(
  "rejects cross-project creation and inactive mutation callers before any Bob write",
  () => {
    const calls: Array<string> = [];
    let active = true;
    const live = McpHttpServer.layerCoordinationToolkit.pipe(
      Layer.provideMerge(McpServer.McpServer.layer),
      Layer.provide(
        Layer.mock(Threads.ThreadManagementService)({
          getThreadShell: () =>
            Effect.succeed({ ...caller, activeRunId: active ? caller.activeRunId : null }),
        }),
      ),
      Layer.provide(
        Layer.succeed(Bob.BobConfiguration, {
          read: Effect.succeed({
            projects: { project: { target, issueProject } },
            executionProfiles: {},
          }),
        }),
      ),
      Layer.provide(
        Layer.mock(Bob.BobCoordination)({
          call: (request) => {
            calls.push(request.operation);
            return Effect.die("Unexpected Bob write");
          },
        }),
      ),
    );
    return Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const input = {
        operation: "CreatePlan",
        idempotencyKey: "create",
        input: {
          contractVersion: "1",
          commandId: "create",
          plan: {
            items: [
              {
                itemId: "item",
                target: { ...target, projectId: "other" },
                issue: { ...issueProject, issueId: "issue" },
                issueSnapshotRef: "scope",
                completionTarget: "production",
              },
            ],
            dependencies: [],
            concurrencyLimit: 1,
          },
        },
      };
      const call = () =>
        server
          .callTool({ name: "bob_coordination", arguments: input })
          .pipe(
            Effect.provideService(Invocation.McpInvocationContext, scope),
            Effect.provideService(McpSchema.McpServerClient, client),
          );
      const crossProject = yield* call();
      expect(failureOf(crossProject)).toMatchObject({
        _tag: "OrchestratorMcpFailure",
        code: "invalid_request",
      });
      expect(calls).toEqual([]);
      active = false;
      const inactive = yield* call();
      expect(failureOf(inactive)).toMatchObject({
        _tag: "OrchestratorMcpFailure",
        code: "invalid_request",
      });
      expect(calls).toEqual([]);
    }).pipe(Effect.provide(live));
  },
);
