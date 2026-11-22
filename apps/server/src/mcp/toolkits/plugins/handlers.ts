import { type McpPluginError, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as McpPlugins from "../../../plugins/McpPlugins.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PluginToolkit } from "./tools.ts";

const summarize = ({ manifest, enabled }: McpPlugins.McpPluginRecord) => ({
  pluginId: manifest.id,
  displayName: manifest.displayName,
  version: manifest.version,
  enabled,
});

const failure = (error: McpPluginError) =>
  Effect.fail(
    new OrchestratorMcpFailure({
      code: error.reason === "storage-failed" ? "orchestration_error" : "invalid_request",
      message: error.message,
    }),
  );

export const layer = McpToolAccess.toLayer(PluginToolkit, {
  t3_plugin_list: McpToolAccess.reads(() =>
    McpPlugins.McpPlugins.pipe(
      Effect.flatMap((plugins) => plugins.list),
      Effect.catchTags({ McpPluginError: failure }),
      Effect.map((records) => ({ plugins: records.map(summarize) })),
    ),
  ),
  t3_plugin_install: McpToolAccess.writesEnvironment((input, check) =>
    McpPlugins.McpPlugins.pipe(
      Effect.flatMap((plugins) => plugins.installFromDirectory(input, check)),
      Effect.catchTags({ McpPluginError: failure }),
      Effect.map(summarize),
    ),
  ),
  t3_plugin_update: McpToolAccess.writesEnvironment((input, check) =>
    McpPlugins.McpPlugins.pipe(
      Effect.flatMap((plugins) => plugins.update(input, check)),
      Effect.catchTags({ McpPluginError: failure }),
      Effect.map(summarize),
    ),
  ),
  t3_plugin_set_enabled: McpToolAccess.writesEnvironment(({ pluginId, enabled }, check) =>
    McpPlugins.McpPlugins.pipe(
      Effect.flatMap((plugins) => plugins.setEnabled(pluginId, enabled, check)),
      Effect.catchTags({ McpPluginError: failure }),
      Effect.map(summarize),
    ),
  ),
  t3_plugin_uninstall: McpToolAccess.writesEnvironment(({ pluginId }, check) =>
    McpPlugins.McpPlugins.pipe(
      Effect.flatMap((plugins) => plugins.uninstall(pluginId, check)),
      Effect.catchTags({ McpPluginError: failure }),
      Effect.as({ pluginId }),
    ),
  ),
});
