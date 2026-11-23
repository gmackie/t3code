import {
  McpPluginId,
  McpPluginIdInput,
  McpPluginInstallInput,
  McpPluginSetEnabledInput,
  McpPluginUpdateInput,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpPlugins from "../../../plugins/McpPlugins.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
    McpPlugins.McpPlugins,
  ],
};

const PluginSummary = Schema.Struct({
  pluginId: McpPluginId,
  displayName: Schema.String,
  version: Schema.String,
  enabled: Schema.Boolean,
});

const PluginListTool = Tool.make("t3_plugin_list", {
  ...shared,
  description: "List installed T3 MCP plugins and their IDs, versions and enabled state.",
  success: Schema.Struct({ plugins: Schema.Array(PluginSummary) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const PluginInstallTool = Tool.make("t3_plugin_install", {
  ...shared,
  description:
    "Install a T3 MCP plugin the user requests from a prepared folder with t3-plugin.json on this environment. Installing can run plugin code. Full access required.",
  parameters: Schema.Struct({ directory: McpPluginInstallInput.fields.directory }),
  success: PluginSummary,
}).annotate(Tool.Destructive, true);

const PluginUpdateTool = Tool.make("t3_plugin_update", {
  ...shared,
  description:
    "Reload an installed T3 MCP plugin after its files have been updated. Give its manifest pluginId and, optionally, the absolute path to a prepared replacement directory on this environment. Omit directory to use its saved folder. Full access required.",
  parameters: McpPluginUpdateInput,
  success: PluginSummary,
}).annotate(Tool.Destructive, true);

const PluginSetEnabledTool = Tool.make("t3_plugin_set_enabled", {
  ...shared,
  description:
    "Enable or disable an installed T3 MCP plugin by ID on this environment. Full access required.",
  parameters: McpPluginSetEnabledInput,
  success: PluginSummary,
}).annotate(Tool.Destructive, true);

const PluginUninstallTool = Tool.make("t3_plugin_uninstall", {
  ...shared,
  description:
    "Uninstall the requested T3 MCP plugin by ID. Removes its configuration and panels, and leaves its source files. Full access required.",
  parameters: McpPluginIdInput,
  success: McpPluginIdInput,
}).annotate(Tool.Destructive, true);

export const PluginToolkit = Toolkit.make(
  PluginListTool,
  PluginInstallTool,
  PluginUpdateTool,
  PluginSetEnabledTool,
  PluginUninstallTool,
);
