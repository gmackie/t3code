import {
  isMcpAppPluginPanelSource,
  McpAppRequestError,
  type McpAppCallToolInput,
  type McpAppCallToolResult,
  type McpAppOpenPanelInput,
  type McpAppOpenPanelResult,
  type McpAppPanelContext,
  type McpAppPanelContextInput,
  type McpAppReadResourceInput,
  type McpAppReadResourceResult,
  type McpAppToolInfo,
  type McpAppToolInfoInput,
  type McpAppUpdateModelContextInput,
  type McpPluginId,
  type McpPluginPanelId,
  type OrchestrationV2AppThread,
  type ProjectId,
  type ThreadId,
  type TurnItemId,
} from "@t3tools/contracts";
import { mcpAppToolCallableByApp, type McpAppReference } from "@t3tools/shared/mcpApp";
import { mcpAppFromToolItem } from "@t3tools/shared/toolOutput";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as McpClientPool from "../mcp/McpClientPool.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as McpPlugins from "../plugins/McpPlugins.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as McpAppModelContext from "./McpAppModelContext.ts";
import { snapshotMcpApp } from "./McpAppSnapshot.ts";

/**
 * Serves MCP Apps views. A thread item's app goes through the live provider
 * session that produced it, and stopped sessions are reported, never started,
 * so views don't spend provider turns. A plugin panel goes through T3's own
 * connection to the plugin's server and needs no thread.
 */
export class McpAppRequests extends Context.Service<
  McpAppRequests,
  {
    readonly callTool: (
      input: McpAppCallToolInput,
    ) => Effect.Effect<McpAppCallToolResult, McpAppRequestError>;
    readonly toolInfo: (
      input: McpAppToolInfoInput,
    ) => Effect.Effect<McpAppToolInfo, McpAppRequestError>;
    readonly readResource: (
      input: McpAppReadResourceInput,
    ) => Effect.Effect<McpAppReadResourceResult, McpAppRequestError>;
    readonly updateModelContext: (
      input: McpAppUpdateModelContextInput,
    ) => Effect.Effect<void, McpAppRequestError>;
    readonly openPanel: (
      input: McpAppOpenPanelInput,
    ) => Effect.Effect<McpAppOpenPanelResult, McpAppRequestError>;
    /** Best effort: a missing project, thread or repository just leaves fields out. */
    readonly panelContext: (input: McpAppPanelContextInput) => Effect.Effect<McpAppPanelContext>;
  }
>()("t3/mcpApps/McpAppRequests") {}

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const utf8 = new TextEncoder();

const readOnlyHint = (tool: ProviderAdapter.ProviderAdapterV2McpTool) =>
  Predicate.isObject(tool.annotations) && tool.annotations.readOnlyHint === true;

const toolTitle = (tool: ProviderAdapter.ProviderAdapterV2McpTool) =>
  Predicate.isObject(tool.annotations) && typeof tool.annotations.title === "string"
    ? tool.annotations.title
    : undefined;

type ThreadItemSource = { readonly threadId: ThreadId; readonly itemId: TurnItemId };
type PluginPanelSource = {
  readonly pluginId: McpPluginId;
  readonly panelId: McpPluginPanelId;
  readonly projectId: ProjectId;
};
type Source = ThreadItemSource | PluginPanelSource;

/** One app's MCP server, reached through a provider session or T3's own pool. */
interface AppServer {
  readonly listTools: Effect.Effect<
    ReadonlyArray<ProviderAdapter.ProviderAdapterV2McpTool>,
    McpAppRequestError
  >;
  readonly callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Effect.Effect<McpAppCallToolResult, McpAppRequestError>;
  readonly readResource: (
    uri: string,
  ) => Effect.Effect<McpAppReadResourceResult, McpAppRequestError>;
}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const providerSessions = yield* ProviderSessionManager.ProviderSessionManagerV2;
  const modelContext = yield* McpAppModelContext.McpAppModelContext;
  const plugins = yield* McpPlugins.McpPlugins;
  const pool = yield* McpClientPool.McpClientPool;
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const projects = yield* ProjectService.ProjectService;
  // Optional so harnesses without VCS still build; panels then get no remotes.
  const vcs = yield* Effect.serviceOption(VcsDriverRegistry.VcsDriverRegistry);

  const fail = (
    source: { readonly threadId: ThreadId } | { readonly pluginId: McpPluginId },
    reason: McpAppRequestError["reason"],
    cause?: unknown,
  ) =>
    new McpAppRequestError({
      ...("pluginId" in source ? { pluginId: source.pluginId } : { threadId: source.threadId }),
      reason,
      ...(cause === undefined ? {} : { cause }),
    });

  const resolveApp = Effect.fn("McpAppRequests.resolveApp")(function* (input: ThreadItemSource) {
    const item = yield* orchestrator
      .getTurnItem({ threadId: input.threadId, itemId: input.itemId })
      .pipe(Effect.mapError((cause) => fail(input, "request-failed", cause)));
    const app: McpAppReference | undefined =
      item?.type === "dynamic_tool" ? mcpAppFromToolItem(item) : undefined;
    if (item === null || app === undefined || item.providerThreadId === null) {
      return yield* fail(input, "not-an-app");
    }
    return { app, providerThreadId: item.providerThreadId };
  });

  const threadServer = Effect.fn("McpAppRequests.threadServer")(function* (
    input: ThreadItemSource,
  ) {
    const { app, providerThreadId } = yield* resolveApp(input);
    const projection = yield* threadManagement
      .getThreadRecords(input.threadId, ["providerThreads"])
      .pipe(Effect.mapError((cause) => fail(input, "request-failed", cause)));
    const providerThread = projection.providerThreads.find(
      (candidate) => candidate.id === providerThreadId,
    );
    if (providerThread?.providerSessionId == null) {
      return yield* fail(input, "session-stopped");
    }
    const runtime = Option.getOrUndefined(
      yield* providerSessions
        .get(providerThread.providerSessionId)
        .pipe(Effect.mapError((cause) => fail(input, "request-failed", cause))),
    );
    if (runtime === undefined) return yield* fail(input, "session-stopped");
    const mcpApps: ProviderAdapter.ProviderAdapterV2McpApps | undefined = runtime.mcpApps;
    if (mcpApps === undefined) return yield* fail(input, "provider-unsupported");
    const requestFailed = Effect.mapError((cause: unknown) => fail(input, "request-failed", cause));
    return {
      listTools: mcpApps.listTools({ providerThread, server: app.server }).pipe(requestFailed),
      callTool: (name, args) =>
        mcpApps
          .callTool({ providerThread, server: app.server, tool: name, arguments: args })
          .pipe(requestFailed),
      readResource: (uri) =>
        mcpApps.readResource({ providerThread, server: app.server, uri }).pipe(requestFailed),
    } satisfies AppServer;
  });

  const pluginFailure =
    (input: PluginPanelSource) =>
    (error: McpClientPool.McpClientPoolFailure): McpAppRequestError =>
      error._tag === "McpServerNeedsAuthError"
        ? fail(input, "needs-auth", error)
        : fail(input, "request-failed", error);

  const resolvePanel = Effect.fn("McpAppRequests.resolvePanel")(function* (
    input: PluginPanelSource,
  ) {
    return yield* plugins
      .resolvePanel(input)
      .pipe(
        Effect.mapError((error) =>
          error._tag === "McpPluginPanelUnavailableError"
            ? fail(input, "plugin-unavailable", error)
            : error._tag === "McpServerNeedsAuthError"
              ? fail(input, "needs-auth", error)
              : fail(input, "request-failed", error),
        ),
      );
  });

  const pluginServer = Effect.fn("McpAppRequests.pluginServer")(function* (
    input: PluginPanelSource,
  ) {
    const { server } = yield* resolvePanel(input);
    const failed = pluginFailure(input);
    return {
      listTools: pool.listTools(server).pipe(Effect.mapError(failed)),
      callTool: (name, args) =>
        pool.callTool(server, { name, arguments: args }).pipe(Effect.mapError(failed)),
      readResource: (uri) => pool.readResource(server, uri).pipe(Effect.mapError(failed)),
    } satisfies AppServer;
  });

  const appServer = (input: Source) =>
    isMcpAppPluginPanelSource(input) ? pluginServer(input) : threadServer(input);

  const findTool = Effect.fn("McpAppRequests.findTool")(function* (
    server: AppServer,
    name: string,
  ) {
    const tools = yield* server.listTools;
    return tools.find((tool) => tool.name === name);
  });

  const toolInfo = Effect.fn("McpAppRequests.toolInfo")(function* (input: McpAppToolInfoInput) {
    const tool = yield* findTool(yield* appServer(input), input.name);
    const title = tool === undefined ? undefined : toolTitle(tool);
    return {
      callable: tool !== undefined && mcpAppToolCallableByApp(tool._meta),
      readOnly: tool !== undefined && readOnlyHint(tool),
      ...(title === undefined ? {} : { title }),
      ...(tool === undefined ? {} : { tool }),
    } satisfies McpAppToolInfo;
  });

  const callTool = Effect.fn("McpAppRequests.callTool")(function* (input: McpAppCallToolInput) {
    const server = yield* appServer(input);
    // Enforce hidden-tool restrictions server-side; client checks cannot enforce the spec.
    const tool = yield* findTool(server, input.name);
    if (tool === undefined || !mcpAppToolCallableByApp(tool._meta)) {
      return yield* fail(input, "tool-not-callable");
    }
    return yield* server.callTool(input.name, input.arguments);
  });

  const readResource = Effect.fn("McpAppRequests.readResource")(function* (
    input: McpAppReadResourceInput,
  ) {
    const server = yield* appServer(input);
    return yield* server.readResource(input.uri);
  });

  const openPanel = Effect.fn("McpAppRequests.openPanel")(function* (input: McpAppOpenPanelInput) {
    const source: PluginPanelSource = {
      pluginId: input.pluginId,
      panelId: input.panelId,
      projectId: input.projectId,
    };
    const failed = pluginFailure(source);
    const opened = Effect.gen(function* () {
      const { record, panel, server } = yield* resolvePanel(source);
      const resource = yield* pool
        .readResource(server, panel.resourceUri)
        .pipe(Effect.mapError(failed));
      const pluginSegment = McpPlugins.pluginAttachmentSegment(record.manifest.id);
      const view =
        pluginSegment === null
          ? undefined
          : yield* snapshotMcpApp({
              attachmentsDir,
              owner: { pluginSegment },
              server: server.name,
              tool: panel.tool?.name ?? "",
              resourceUri: panel.resourceUri,
              contents: resource.contents,
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.mapError((cause) => fail(source, "request-failed", cause)),
            );
      if (view === undefined) return yield* fail(source, "unsupported-content");
      // The manifest names the opening tool, so it runs whatever its visibility.
      const toolCall =
        panel.tool === undefined
          ? undefined
          : {
              name: panel.tool.name,
              arguments: panel.tool.arguments,
              result: yield* pool
                .callTool(server, { name: panel.tool.name, arguments: panel.tool.arguments })
                .pipe(Effect.mapError(failed)),
            };
      return {
        status: "ready",
        attachmentId: view.attachmentId,
        server: server.name,
        resourceUri: view.resourceUri,
        ...(view.csp === undefined ? {} : { csp: view.csp }),
        ...(view.permissions === undefined ? {} : { permissions: view.permissions }),
        ...(view.prefersBorder === undefined ? {} : { prefersBorder: view.prefersBorder }),
        ...(toolCall === undefined ? {} : { toolCall }),
      } satisfies McpAppOpenPanelResult;
    });
    // The registry name, not the plugin's: sign-in is keyed by the Tools entry.
    return yield* opened.pipe(
      Effect.catchIf(
        (error) =>
          error.reason === "needs-auth" && McpClientPool.isMcpServerNeedsAuthError(error.cause),
        (error) =>
          Effect.succeed({
            status: "needs-auth",
            server: (error.cause as McpClientPool.McpServerNeedsAuthError).server,
          } satisfies McpAppOpenPanelResult),
      ),
    );
  });

  const descendsFrom = Effect.fn("McpAppRequests.descendsFrom")(function* (
    threadId: ThreadId,
    ancestorId: ThreadId,
  ) {
    const seen = new Set<ThreadId>();
    let current: ThreadId | null = threadId;
    while (current !== null && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      const records: { readonly thread: OrchestrationV2AppThread } = yield* threadManagement
        .getThreadRecords(current, [])
        .pipe(Effect.mapError((cause) => fail({ threadId }, "request-failed", cause)));
      const { lineage } = records.thread;
      current = lineage.relationshipToParent === "fork" ? lineage.parentThreadId : null;
    }
    return false;
  });

  const updateModelContext = Effect.fn("McpAppRequests.updateModelContext")(function* (
    input: McpAppUpdateModelContextInput,
  ) {
    const { app } = yield* resolveApp(input);
    // Context belongs only to the app's thread or its descendants.
    if (!(yield* descendsFrom(input.conversationThreadId, input.threadId))) {
      return yield* fail(input, "not-an-app");
    }
    const texts: Array<string> = [];
    for (const block of input.content ?? []) {
      if (!Predicate.isObject(block) || block.type !== "text" || typeof block.text !== "string") {
        return yield* fail(input, "unsupported-content");
      }
      texts.push(block.text);
    }
    if (input.structuredContent !== undefined) {
      texts.push(encodeJson(input.structuredContent));
    }
    const text = texts.join("\n");
    if (utf8.encode(text).byteLength > McpAppModelContext.MCP_APP_MODEL_CONTEXT_MAX_BYTES) {
      return yield* fail(input, "request-failed", new Error("Model context is too large."));
    }
    yield* modelContext
      .set({
        threadId: input.conversationThreadId,
        itemId: input.itemId,
        server: app.server,
        tool: app.tool,
        text,
      })
      .pipe(Effect.mapError((cause) => fail(input, "request-failed", cause)));
  });

  const panelContext = Effect.fn("McpAppRequests.panelContext")(function* (
    input: McpAppPanelContextInput,
  ) {
    const project = Option.getOrUndefined(
      yield* projects.getById(input.projectId).pipe(Effect.orElseSucceed(() => Option.none())),
    );
    const thread =
      input.threadId === undefined
        ? undefined
        : yield* threadManagement.getThreadRecords(input.threadId, []).pipe(
            Effect.map((records) => records.thread),
            Effect.orElseSucceed(() => undefined),
          );
    const cwd = thread?.worktreePath ?? project?.workspaceRoot;
    if (cwd === undefined) return {};
    const remotes = Option.isNone(vcs)
      ? undefined
      : yield* vcs.value.resolve({ cwd }).pipe(
          Effect.flatMap((handle) => handle.driver.listRemotes(cwd)),
          Effect.map((result) => result.remotes.map(({ name, url }) => ({ name, url }))),
          Effect.orElseSucceed(() => undefined),
        );
    const branch = thread?.branch ?? undefined;
    return {
      cwd,
      ...(remotes === undefined
        ? {}
        : { git: { remotes, ...(branch === undefined ? {} : { branch }) } }),
    } satisfies McpAppPanelContext;
  });

  return McpAppRequests.of({
    callTool,
    toolInfo,
    readResource,
    updateModelContext,
    openPanel,
    panelContext,
  });
});

export const layer = Layer.effect(McpAppRequests, make);
