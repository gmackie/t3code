import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { McpPluginId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as McpClientPool from "../mcp/McpClientPool.ts";
import * as McpSessionRegistryTestkit from "../mcp/McpSessionRegistry.testkit.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as McpPlugins from "./McpPlugins.ts";

const layer = () =>
  McpPlugins.layer.pipe(
    Layer.provideMerge(McpClientPool.layer),
    Layer.provide(McpSessionRegistryTestkit.layer),
    Layer.provideMerge(ServerSettings.layer),
    Layer.provide(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3code-mcp-plugins-" })),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

const manifestJson = {
  schemaVersion: 2,
  id: "com.example.board",
  displayName: "Board",
  version: "0.1.0",
  mcpServer: {
    name: "board",
    transport: {
      type: "stdio",
      command: "node",
      args: ["${pluginRoot}/server.mjs"],
      env: [
        { name: "BOARD_URL", value: "https://board.example", title: "Board URL" },
        { name: "BOARD_TOKEN", value: "", sensitive: true },
      ],
    },
  },
  contributes: {
    panels: [{ id: "main", title: "Main", scope: "project", resourceUri: "ui://board/main" }],
  },
};

const writePluginDir = (contents: unknown) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-plugin-" });
    yield* fileSystem.writeFileString(
      path.join(directory, "t3-plugin.json"),
      JSON.stringify(contents),
    );
    return directory;
  });

it.effect("installs from a directory, resolving ${pluginRoot} and filling variables", () =>
  Effect.gen(function* () {
    const plugins = yield* McpPlugins.McpPlugins;
    const settings = yield* ServerSettings.ServerSettingsService;
    const directory = yield* writePluginDir(manifestJson);

    const record = yield* plugins.installFromDirectory({
      directory,
      variables: { BOARD_TOKEN: "secret-1" },
    });
    assert.equal(record.manifest.id, "com.example.board");
    const entry = (yield* settings.getSettings).mcpServers.board;
    assert.deepEqual(entry?.plugin, { id: "com.example.board", displayName: "Board" });
    assert.isTrue(entry?.transport.type === "stdio");
    if (entry?.transport.type !== "stdio") return;
    assert.deepEqual(entry.transport.args, [`${directory}/server.mjs`]);
    assert.deepEqual(
      entry.transport.env.map(({ name, value }) => [name, value]),
      [
        ["BOARD_URL", "https://board.example"],
        ["BOARD_TOKEN", "secret-1"],
      ],
    );

    // An upgrade keeps stored values it isn't given.
    yield* plugins.installFromDirectory({ directory });
    const upgraded = (yield* settings.getSettings).mcpServers.board;
    assert.isTrue(
      upgraded?.transport.type === "stdio" &&
        upgraded.transport.env.some((v) => v.name === "BOARD_TOKEN" && v.value === "secret-1"),
    );
  }).pipe(Effect.scoped, Effect.provide(layer())),
);

it.effect("rejects a directory without a valid v2 manifest", () =>
  Effect.gen(function* () {
    const plugins = yield* McpPlugins.McpPlugins;
    const directory = yield* writePluginDir({ ...manifestJson, schemaVersion: 1 });
    const error = yield* Effect.flip(plugins.installFromDirectory({ directory }));
    assert.equal(error.reason, "invalid-manifest");
  }).pipe(Effect.scoped, Effect.provide(layer())),
);

it.effect("lets clients switch a plugin's Tools entry off but not edit, remove or claim one", () =>
  Effect.gen(function* () {
    const plugins = yield* McpPlugins.McpPlugins;
    const settings = yield* ServerSettings.ServerSettingsService;
    yield* plugins.installFromDirectory({ directory: yield* writePluginDir(manifestJson) });
    const owned = (yield* settings.getSettings).mcpServers.board;
    if (owned === undefined) return assert.fail("plugin entry missing");

    const switchedOff = yield* plugins.guardSettingsPatch({
      mcpServers: {
        board: {
          enabled: false,
          transport: { type: "http", url: "https://evil.example/mcp", headers: [] },
        },
      },
    });
    assert.deepEqual(switchedOff.mcpServers?.board, { ...owned, enabled: false });

    const removal = yield* Effect.flip(plugins.guardSettingsPatch({ mcpServers: { board: null } }));
    assert.equal(removal.reason, "plugin-owned-server");

    const claimed = yield* plugins.guardSettingsPatch({
      mcpServers: {
        mine: {
          enabled: true,
          plugin: { id: "com.example.board", displayName: "Board" },
          transport: { type: "http", url: "https://mine.example/mcp", headers: [] },
        },
      },
    });
    assert.isUndefined(claimed.mcpServers?.mine?.plugin);

    yield* plugins.uninstall(McpPluginId.make("com.example.board"));
    assert.lengthOf(yield* plugins.list, 0);
  }).pipe(Effect.scoped, Effect.provide(layer())),
);
