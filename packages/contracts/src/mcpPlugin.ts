import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { McpServerName, McpServerTransport } from "./agentTools.ts";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Reverse-DNS, e.g. `com.gmacko.kanbanger`. */
export const McpPluginId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/),
  Schema.isMaxLength(255),
);
export type McpPluginId = typeof McpPluginId.Type;

export const McpPluginPanelId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]*$/),
  Schema.isMaxLength(64),
);
export type McpPluginPanelId = typeof McpPluginPanelId.Type;

/**
 * A view the plugin's server serves as an MCP Apps `ui://` resource. A thread
 * panel follows the active thread through host context; a project panel needs none.
 */
export const McpPluginPanel = Schema.Struct({
  id: McpPluginPanelId,
  title: TrimmedNonEmptyString,
  scope: Schema.Literals(["thread", "project"]),
  resourceUri: TrimmedNonEmptyString.check(Schema.isPattern(/^ui:\/\//), Schema.isMaxLength(4096)),
  /**
   * Run when the panel opens and delivered as the view's tool input and result,
   * so a view behaves the same in a panel as inline after a tool call.
   */
  tool: Schema.optionalKey(
    Schema.Struct({
      name: TrimmedNonEmptyString,
      arguments: Schema.Record(Schema.String, Schema.Unknown).pipe(
        Schema.withDecodingDefault(Effect.succeed({})),
      ),
    }),
  ),
});
export type McpPluginPanel = typeof McpPluginPanel.Type;

export const McpPluginCommand = Schema.Struct({
  id: McpPluginPanelId,
  title: TrimmedNonEmptyString,
  panel: McpPluginPanelId,
});
export type McpPluginCommand = typeof McpPluginCommand.Type;

/**
 * Plugin manifest v2: one MCP server for agents (a plugin-owned Tools entry) and panels.
 * Variables bind to `transport.env`/`headers` by name, `value` is the default, and
 * `${pluginRoot}` in a stdio command or args becomes the plugin's install directory.
 */
export const McpPluginManifest = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  id: McpPluginId,
  displayName: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  description: Schema.optionalKey(Schema.String),
  mcpServer: Schema.Struct({
    name: McpServerName,
    transport: McpServerTransport,
  }),
  contributes: Schema.Struct({
    panels: Schema.Array(McpPluginPanel).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
    commands: Schema.Array(McpPluginCommand).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  }).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  t3Tools: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
}).check(
  Schema.makeFilter((manifest) => {
    const panelIds = new Set<string>();
    for (const panel of manifest.contributes.panels) {
      if (panelIds.has(panel.id)) return `Panel "${panel.id}" is declared twice.`;
      panelIds.add(panel.id);
    }
    const missing = manifest.contributes.commands.find((command) => !panelIds.has(command.panel));
    return missing === undefined
      ? true
      : `Command "${missing.id}" opens unknown panel "${missing.panel}".`;
  }),
);
export type McpPluginManifest = typeof McpPluginManifest.Type;

export const McpPluginEntry = Schema.Struct({
  manifest: McpPluginManifest,
  directory: Schema.optionalKey(Schema.String),
  enabled: Schema.Boolean,
});
export type McpPluginEntry = typeof McpPluginEntry.Type;

/** Installs or upgrades the plugin whose `t3-plugin.json` is in `directory` on the server. */
export const McpPluginInstallInput = Schema.Struct({
  directory: TrimmedNonEmptyString,
  variables: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type McpPluginInstallInput = typeof McpPluginInstallInput.Type;

export const McpPluginIdInput = Schema.Struct({ pluginId: McpPluginId });
export type McpPluginIdInput = typeof McpPluginIdInput.Type;

export const McpPluginSetEnabledInput = Schema.Struct({
  pluginId: McpPluginId,
  enabled: Schema.Boolean,
});
export type McpPluginSetEnabledInput = typeof McpPluginSetEnabledInput.Type;

export class McpPluginError extends Schema.TaggedError<McpPluginError>()("McpPluginError", {
  reason: Schema.Literals([
    "not-installed",
    "invalid-manifest",
    "server-name-taken",
    "plugin-owned-server",
    "storage-failed",
  ]),
  pluginId: Schema.optionalKey(Schema.String),
  server: Schema.optionalKey(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not-installed":
        return `Plugin "${this.pluginId}" isn't installed.`;
      case "invalid-manifest":
        return "The directory has no valid v2 t3-plugin.json.";
      case "server-name-taken":
        return `Settings → Tools already has a server named "${this.server}". Rename or remove it to install this plugin.`;
      case "plugin-owned-server":
        return `"${this.server}" belongs to a plugin. Switch it off here, or uninstall the plugin to remove it.`;
      case "storage-failed":
        return "Failed to save the installed plugins.";
    }
  }
}
