// @effect-diagnostics nodeBuiltinImport:off - The needs-auth test serves a 401 with node:http.
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

import {
  McpPluginId,
  McpPluginManifest,
  McpPluginPanelId,
  ProjectId,
  ProviderDriverKind,
  ProviderSessionId,
  ProviderThreadId,
  ThreadId,
  TurnItemId,
  type McpAppRequestError,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as McpClientPool from "../mcp/McpClientPool.ts";
import * as McpRemoteAuth from "../mcp/McpRemoteAuth.ts";
import * as McpSessionRegistryTestkit from "../mcp/McpSessionRegistry.testkit.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as McpPlugins from "../plugins/McpPlugins.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderSessionManager from "../orchestration-v2/ProviderSessionManager.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as McpAppModelContext from "./McpAppModelContext.ts";
import * as McpAppRequests from "./McpAppRequests.ts";

const threadId = ThreadId.make("thread-app");
const itemId = TurnItemId.make("item-app");
const providerThreadId = ProviderThreadId.make("provider-thread-app");
const providerSessionId = ProviderSessionId.make("provider-session-app");
const forkId = ThreadId.make("thread-fork");
const branchThreadId = ThreadId.make("thread-branch");
const unrelatedId = ThreadId.make("thread-unrelated");
const deepForkId = (depth: number) => ThreadId.make(`thread-deep-${depth}`);
const deepParent = (id: ThreadId): ThreadId | null => {
  const match = /^thread-deep-(\d+)$/.exec(id);
  if (match === null) return null;
  const depth = Number(match[1]);
  return depth === 1 ? threadId : deepForkId(depth - 1);
};

const appItem = (output: unknown): OrchestrationV2TurnItem => ({
  id: itemId,
  threadId,
  runId: null,
  nodeId: null,
  providerThreadId,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status: "completed",
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: DateTime.makeUnsafe(0),
  type: "dynamic_tool",
  toolName: "weather.get_weather",
  input: {},
  output,
});

const app = {
  attachmentId: "thread-app-00000000-0000-0000-0000-000000000000-html",
  server: "weather",
  tool: "get_weather",
  resourceUri: "ui://weather/dashboard",
};

const storedContext = new Map<string, string>();

/** The real plugin stack: settings, installed plugins and the pool, in a temp state dir. */
const layerPluginStack = () =>
  McpPlugins.layer.pipe(
    Layer.provideMerge(McpClientPool.layer),
    Layer.provide(McpSessionRegistryTestkit.layer),
    Layer.provideMerge(McpRemoteAuth.layer),
    Layer.provideMerge(ServerSettings.layer),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provideMerge(ManagedPolicy.layerTest()),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-mcp-app-requests-" })),
    ),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

function makeLayer(input: {
  readonly item: OrchestrationV2TurnItem | null;
  readonly mcpApps?: ProviderAdapter.ProviderAdapterV2McpApps;
  readonly live?: boolean;
}) {
  return McpAppRequests.layer.pipe(
    Layer.provideMerge(layerPluginStack()),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(McpAppModelContext.McpAppModelContext)({
          set: (entry) =>
            Effect.sync(() => {
              const key = `${entry.threadId}/${entry.itemId}`;
              if (entry.text.trim() === "") storedContext.delete(key);
              else storedContext.set(key, entry.text);
            }),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          getTurnItem: () => Effect.succeed(input.item),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: (id) =>
            Effect.succeed(
              id === "project-plugins"
                ? Option.some({ workspaceRoot: "/repo/main" } as never)
                : Option.none(),
            ),
        }),
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          resolve: ({ cwd }) =>
            Effect.succeed({
              driver: {
                listRemotes: () =>
                  Effect.succeed({
                    remotes: [
                      {
                        name: "origin",
                        url: `https://git.example/${cwd.split("/").at(-1)}.git`,
                        pushUrl: Option.none(),
                        isPrimary: true,
                      },
                    ],
                  }),
              },
            } as never),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadRecords: (id: ThreadId) =>
            Effect.succeed({
              thread: {
                ...(id === branchThreadId
                  ? { branch: "feature/checks", worktreePath: "/repo/worktrees/checks" }
                  : { branch: null, worktreePath: null }),
                lineage:
                  deepParent(id) !== null
                    ? {
                        parentThreadId: deepParent(id),
                        relationshipToParent: "fork",
                        rootThreadId: threadId,
                      }
                    : id === forkId
                      ? {
                          parentThreadId: threadId,
                          relationshipToParent: "fork",
                          rootThreadId: threadId,
                        }
                      : { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
              },
              providerThreads: [
                { id: providerThreadId, providerSessionId } as OrchestrationV2ProviderThread,
              ],
            } as never),
        }),
        Layer.mock(ProviderSessionManager.ProviderSessionManagerV2)({
          get: () =>
            Effect.succeed(
              input.live === false
                ? Option.none()
                : Option.some(
                    (input.mcpApps === undefined
                      ? {}
                      : {
                          mcpApps: input.mcpApps,
                        }) as ProviderAdapter.ProviderAdapterV2SessionRuntime,
                  ),
            ),
        }),
      ),
    ),
  );
}

const reason = <A, R>(effect: Effect.Effect<A, McpAppRequestError, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

describe("McpAppRequests", () => {
  const calls: Array<{ server: string; tool: string }> = [];
  const mcpApps: ProviderAdapter.ProviderAdapterV2McpApps = {
    listTools: () =>
      Effect.succeed([
        { name: "refresh", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
        {
          name: "model_only",
          inputSchema: { type: "object" },
          _meta: { ui: { visibility: ["model"] } },
        },
      ]),
    callTool: (input) =>
      Effect.sync(() => {
        calls.push({ server: input.server, tool: input.tool });
        return { content: [{ type: "text", text: "ok" }] };
      }),
    readResource: () => Effect.succeed({ contents: [] }),
  };

  it.effect("calls tools on the app's own server and reports their read-only hint", () =>
    Effect.gen(function* () {
      const requests = yield* McpAppRequests.McpAppRequests;
      const result = yield* requests.callTool({
        threadId,
        itemId,
        name: "refresh",
        arguments: {},
      });
      assert.deepEqual(result, { content: [{ type: "text", text: "ok" }] });
      assert.deepEqual(calls.at(-1), { server: "weather", tool: "refresh" });
      assert.deepEqual(yield* requests.toolInfo({ threadId, itemId, name: "refresh" }), {
        callable: true,
        readOnly: true,
        tool: {
          name: "refresh",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true },
        },
      });
    }).pipe(Effect.provide(makeLayer({ item: appItem({ t3McpApp: app }), mcpApps }))),
  );

  it.effect("refuses tools hidden from apps or missing from the server", () =>
    Effect.gen(function* () {
      const requests = yield* McpAppRequests.McpAppRequests;
      const before = calls.length;
      for (const name of ["model_only", "unknown"]) {
        assert.equal(
          yield* reason(requests.callTool({ threadId, itemId, name, arguments: {} })),
          "tool-not-callable",
        );
      }
      assert.equal(calls.length, before);
    }).pipe(Effect.provide(makeLayer({ item: appItem({ t3McpApp: app }), mcpApps }))),
  );

  it.effect("reports a provider whose process has stopped as a stopped session", () =>
    Effect.gen(function* () {
      const requests = yield* McpAppRequests.McpAppRequests;
      assert.equal(
        yield* reason(requests.readResource({ threadId, itemId, uri: "ui://weather/app.html" })),
        "session-stopped",
      );
    }).pipe(
      Effect.provide(
        makeLayer({
          item: appItem({ t3McpApp: app }),
          mcpApps: {
            ...mcpApps,
            readResource: () =>
              Effect.fail(
                new ProviderAdapter.ProviderAdapterSessionStoppedError({
                  driver: ProviderDriverKind.make("claudeAgent"),
                }),
              ),
          },
        }),
      ),
    ),
  );

  it.effect("keeps each app's latest model context, without a live session", () =>
    Effect.gen(function* () {
      const requests = yield* McpAppRequests.McpAppRequests;
      const own = { threadId, itemId, conversationThreadId: threadId };
      yield* requests.updateModelContext({
        ...own,
        content: [{ type: "text", text: "  indented value  " }],
      });
      assert.equal(storedContext.get(`${threadId}/${itemId}`), "  indented value  ");
      yield* requests.updateModelContext({
        ...own,
        content: [{ type: "text", text: "Filtered to overdue" }],
        structuredContent: { filter: "overdue" },
      });
      assert.equal(
        storedContext.get(`${threadId}/${itemId}`),
        'Filtered to overdue\n{"filter":"overdue"}',
      );
      assert.equal(
        yield* reason(
          requests.updateModelContext({ ...own, content: [{ type: "image", data: "x" }] }),
        ),
        "unsupported-content",
      );
      assert.equal(
        yield* reason(
          requests.updateModelContext({
            ...own,
            content: [{ type: "text", text: "表".repeat(6000) }],
          }),
        ),
        "request-failed",
      );
      yield* requests.updateModelContext(own);
      assert.isFalse(storedContext.has(`${threadId}/${itemId}`));
    }).pipe(Effect.provide(makeLayer({ item: appItem({ t3McpApp: app }), live: false }))),
  );

  it.effect("stores a fork's model context under the fork, and refuses unrelated threads", () =>
    Effect.gen(function* () {
      const requests = yield* McpAppRequests.McpAppRequests;
      const content = [{ type: "text", text: "Seen from the fork" }];
      yield* requests.updateModelContext({
        threadId,
        itemId,
        conversationThreadId: forkId,
        content,
      });
      assert.equal(storedContext.get(`${forkId}/${itemId}`), "Seen from the fork");
      assert.isFalse(storedContext.has(`${threadId}/${itemId}`));
      assert.equal(
        yield* reason(
          requests.updateModelContext({
            threadId,
            itemId,
            conversationThreadId: unrelatedId,
            content,
          }),
        ),
        "not-an-app",
      );
      yield* requests.updateModelContext({
        threadId,
        itemId,
        conversationThreadId: deepForkId(70),
        content,
      });
      assert.isTrue(storedContext.has(`${deepForkId(70)}/${itemId}`));
    }).pipe(Effect.provide(makeLayer({ item: appItem({ t3McpApp: app }), live: false }))),
  );
});

describe("McpAppRequests plugin panels", () => {
  const projectId = ProjectId.make("project-plugins");
  const otherProjectId = ProjectId.make("project-switched-off");
  const fixtureDir = new URL("../mcp/testing/", import.meta.url).pathname.replace(/\/$/, "");
  const decodeManifest = Schema.decodeUnknownSync(McpPluginManifest);
  const manifest = decodeManifest({
    schemaVersion: 2,
    id: "com.example.fixture",
    displayName: "Fixture",
    version: "1.0.0",
    mcpServer: {
      name: "fixture",
      transport: {
        type: "stdio",
        command: process.execPath,
        args: ["${pluginRoot}/McpClientPool.fixture.mjs"],
        env: [{ name: "FIXTURE_TOKEN", value: "", sensitive: true, title: "Token" }],
      },
    },
    contributes: {
      panels: [
        {
          id: "board",
          title: "Board",
          scope: "project",
          resourceUri: "ui://fixture/panel",
          tool: { name: "whoami" },
        },
      ],
    },
  });
  const pluginId = manifest.id;
  const source = { pluginId, panelId: "board", projectId };

  const installFixture = Effect.gen(function* () {
    const plugins = yield* McpPlugins.McpPlugins;
    yield* plugins.install({
      manifest,
      directory: fixtureDir,
      variables: { FIXTURE_TOKEN: "t0k" },
    });
  });

  const layer = () => makeLayer({ item: null });

  it.effect("opens a panel with no thread and runs its opening tool", () =>
    Effect.gen(function* () {
      yield* installFixture;
      const requests = yield* McpAppRequests.McpAppRequests;
      const opened = yield* requests.openPanel(source);
      assert.equal(opened.status, "ready");
      if (opened.status !== "ready") return;
      assert.match(opened.attachmentId, /^plugin-com-example-fixture-[0-9a-f-]+-html$/);
      assert.equal(opened.server, "fixture");
      const result = opened.toolCall?.result.structuredContent as { readonly token: string };
      assert.equal(result.token, "t0k");

      const { attachmentsDir } = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const viewPath = `${attachmentsDir}/${opened.attachmentId}.html`;
      assert.include(yield* fileSystem.readFileString(viewPath), "<p>panel</p>");
      const reopened = yield* requests.openPanel(source);
      assert.equal(reopened.status === "ready" && reopened.attachmentId, opened.attachmentId);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("opens the example plugin's panel from its folder with no thread", () =>
    Effect.gen(function* () {
      const plugins = yield* McpPlugins.McpPlugins;
      const requests = yield* McpAppRequests.McpAppRequests;
      const directory = new URL("../../../../examples/plugins/hello", import.meta.url).pathname;
      yield* plugins.installFromDirectory({ directory, variables: { HELLO_NAME: "tests" } });
      const opened = yield* requests.openPanel({
        pluginId: McpPluginId.make("com.t3code.hello"),
        panelId: McpPluginPanelId.make("status"),
        projectId,
      });
      assert.equal(opened.status, "ready");
      const greeting =
        opened.status === "ready"
          ? (
              opened.toolCall?.result.structuredContent as
                | { readonly greeting?: string }
                | undefined
            )?.greeting
          : undefined;
      assert.equal(greeting, "Hello, tests!");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("tells a panel its directory and git remotes, and a thread panel its branch", () =>
    Effect.gen(function* () {
      const requests = yield* McpAppRequests.McpAppRequests;
      assert.deepEqual(yield* requests.panelContext({ projectId }), {
        cwd: "/repo/main",
        git: { remotes: [{ name: "origin", url: "https://git.example/main.git" }] },
      });
      assert.deepEqual(yield* requests.panelContext({ projectId, threadId: branchThreadId }), {
        cwd: "/repo/worktrees/checks",
        git: {
          branch: "feature/checks",
          remotes: [{ name: "origin", url: "https://git.example/checks.git" }],
        },
      });
      assert.deepEqual(
        yield* requests.panelContext({ projectId: ProjectId.make("project-missing") }),
        {},
      );
    }).pipe(Effect.provide(layer())),
  );

  it.effect("gives only T3's own copy of the plugin its T3 callback token", () =>
    Effect.gen(function* () {
      const plugins = yield* McpPlugins.McpPlugins;
      const requests = yield* McpAppRequests.McpAppRequests;
      const settings = yield* ServerSettings.ServerSettingsService;
      yield* plugins.install({
        manifest: decodeManifest({ ...manifest, t3Tools: ["t3_thread_read"] }),
        directory: fixtureDir,
      });
      const called = yield* requests.callTool({ ...source, name: "whoami", arguments: {} });
      assert.deepEqual((called.structuredContent as { readonly t3Callback: unknown }).t3Callback, {
        url: "http://127.0.0.1/mcp",
        token: `mcp-test:plugin:${pluginId}`,
      });
      // The Tools entry is what provider sessions get; it never carries the token.
      const entry = (yield* settings.getSettings).mcpServers.fixture;
      assert.isTrue(
        entry?.transport.type === "stdio" &&
          entry.transport.env.every((variable) => !variable.name.startsWith("T3_MCP_")),
      );
    }).pipe(Effect.provide(layer())),
  );

  it.effect("lets a panel call its server's app tools and nothing hidden", () =>
    Effect.gen(function* () {
      yield* installFixture;
      const requests = yield* McpAppRequests.McpAppRequests;
      const called = yield* requests.callTool({ ...source, name: "whoami", arguments: {} });
      assert.equal((called.structuredContent as { readonly token: string }).token, "t0k");
      assert.equal(
        yield* reason(requests.callTool({ ...source, name: "model_only", arguments: {} })),
        "tool-not-callable",
      );
      assert.isFalse((yield* requests.toolInfo({ ...source, name: "model_only" })).callable);
      assert.isTrue((yield* requests.toolInfo({ ...source, name: "whoami" })).callable);
      const resource = yield* requests.readResource({ ...source, uri: "ui://fixture/panel" });
      assert.lengthOf(resource.contents, 1);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("refuses panels of a disabled plugin and of a project that switched it off", () =>
    Effect.gen(function* () {
      yield* installFixture;
      const requests = yield* McpAppRequests.McpAppRequests;
      const plugins = yield* McpPlugins.McpPlugins;
      const settings = yield* ServerSettings.ServerSettingsService;

      yield* plugins.setEnabled(pluginId, false);
      assert.equal(yield* reason(requests.openPanel(source)), "plugin-unavailable");
      assert.isFalse((yield* settings.getSettings).mcpServers.fixture?.enabled);
      yield* plugins.setEnabled(pluginId, true);
      assert.equal((yield* requests.openPanel(source)).status, "ready");

      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [otherProjectId]: { mcpServers: { fixture: { enabled: false } } },
        },
      } as never);
      assert.equal(
        yield* reason(requests.openPanel({ ...source, projectId: otherProjectId })),
        "plugin-unavailable",
      );
      assert.equal((yield* requests.openPanel(source)).status, "ready");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("uninstalling removes the Tools entry and stored views", () =>
    Effect.gen(function* () {
      yield* installFixture;
      const requests = yield* McpAppRequests.McpAppRequests;
      const plugins = yield* McpPlugins.McpPlugins;
      const settings = yield* ServerSettings.ServerSettingsService;
      const opened = yield* requests.openPanel(source);
      const entry = (yield* settings.getSettings).mcpServers.fixture;
      assert.deepEqual(entry?.plugin, { id: pluginId, displayName: "Fixture" });
      assert.deepEqual(entry?.transport.type === "stdio" && entry.transport.args, [
        `${fixtureDir}/McpClientPool.fixture.mjs`,
      ]);

      yield* plugins.uninstall(pluginId);
      assert.isUndefined((yield* settings.getSettings).mcpServers.fixture);
      assert.equal(yield* reason(requests.openPanel(source)), "plugin-unavailable");
      const { attachmentsDir } = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      assert.isFalse(
        yield* fileSystem.exists(
          `${attachmentsDir}/${opened.status === "ready" ? opened.attachmentId : ""}.html`,
        ),
      );
    }).pipe(Effect.provide(layer())),
  );

  it.effect("won't take over a Tools entry the user owns", () =>
    Effect.gen(function* () {
      const plugins = yield* McpPlugins.McpPlugins;
      const settings = yield* ServerSettings.ServerSettingsService;
      yield* settings.updateSettings({
        mcpServers: {
          fixture: {
            enabled: true,
            transport: { type: "http", url: "https://example.com/mcp", headers: [] },
          },
        },
      });
      const error = yield* Effect.flip(plugins.install({ manifest, directory: fixtureDir }));
      assert.equal(error.reason, "server-name-taken");
      assert.isUndefined((yield* settings.getSettings).mcpServers.fixture?.plugin);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("shows a sign-in state when the plugin's server wants one", () =>
    Effect.acquireUseRelease(
      Effect.promise(async () => {
        const http = NodeHttp.createServer((_request, response) => response.writeHead(401).end());
        await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
        return http;
      }),
      (http) =>
        Effect.gen(function* () {
          const plugins = yield* McpPlugins.McpPlugins;
          const requests = yield* McpAppRequests.McpAppRequests;
          const port = (http.address() as NodeNet.AddressInfo).port;
          yield* plugins.install({
            manifest: decodeManifest({
              ...manifest,
              id: "com.example.remote",
              displayName: "Remote",
              mcpServer: {
                name: "remote",
                transport: { type: "http", url: `http://127.0.0.1:${port}/mcp`, headers: [] },
              },
            }),
          });
          assert.deepEqual(
            yield* requests.openPanel({
              ...source,
              pluginId: McpPluginId.make("com.example.remote"),
            }),
            { status: "needs-auth", server: "remote" },
          );
          // An OAuth server with no stored sign-in asks for one before any request.
          yield* plugins.install({
            manifest: decodeManifest({
              ...manifest,
              id: "com.example.oauth",
              displayName: "OAuth",
              mcpServer: {
                name: "oauth-remote",
                transport: {
                  type: "http",
                  url: `http://127.0.0.1:${port}/mcp`,
                  headers: [],
                  auth: { type: "oauth", scopes: ["read"] },
                },
              },
            }),
          });
          assert.deepEqual(
            yield* requests.openPanel({
              ...source,
              pluginId: McpPluginId.make("com.example.oauth"),
            }),
            { status: "needs-auth", server: "oauth-remote" },
          );
        }).pipe(Effect.provide(layer())),
      (http) => Effect.promise(() => new Promise<void>((resolve) => http.close(() => resolve()))),
    ),
  );
});
