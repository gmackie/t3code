import { expect, it } from "@effect/vitest";
import { EnvironmentId, McpPluginId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as McpPlugins from "../../../plugins/McpPlugins.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadsLayer } from "../../McpToolAccess.testkit.ts";
import * as PluginHandlers from "./handlers.ts";
import { PluginToolkit } from "./tools.ts";

it.effect("lets read-only MCP clients list plugins and refuses all lifecycle writes", () =>
  Effect.gen(function* () {
    const toolkit = yield* PluginToolkit;
    const pluginId = McpPluginId.make("com.example.board");
    const result = <A, E, R, SE, SR>(attempt: Effect.Effect<Stream.Stream<A, SE, SR>, E, R>) =>
      attempt.pipe(Stream.unwrap, Stream.runCollect);
    const attempts = [
      result(toolkit.handle("t3_plugin_install", { directory: "/plugins/board" })),
      result(toolkit.handle("t3_plugin_update", { pluginId })),
      result(toolkit.handle("t3_plugin_set_enabled", { pluginId, enabled: true })),
      result(toolkit.handle("t3_plugin_uninstall", { pluginId })),
    ];
    for (const attempt of attempts) {
      const parts = yield* attempt;
      expect(parts.at(-1)?.result).toMatchObject({ code: "capability_denied" });
    }
    const list = yield* toolkit.handle("t3_plugin_list", {}).pipe(Stream.unwrap, Stream.runCollect);
    expect(list.at(-1)?.result).toEqual({ plugins: [] });
  }).pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(PluginHandlers.layer).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            liveThreadsLayer,
            Layer.mock(McpPlugins.McpPlugins)({ list: Effect.succeed([]) }),
            Layer.succeed(McpInvocationContext.McpInvocationContext, {
              environmentId: EnvironmentId.make("environment:plugins"),
              requestNamespace: "client:plugins",
              thread: undefined,
              client: { label: "Reader", sessionId: "client:plugins", access: "read-only" },
              capabilities: new Set(["orchestration" as const]),
              issuedAt: 0,
            }),
          ),
        ),
      ),
    ),
  ),
);
