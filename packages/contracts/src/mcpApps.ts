import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString, TurnItemId } from "./baseSchemas.ts";
import { McpPluginId, McpPluginPanelId } from "./mcpPlugin.ts";

// The producing tool call restricts each app to its source server.
const McpAppThreadItemSource = {
  threadId: ThreadId,
  itemId: TurnItemId,
};

// A plugin panel is restricted to its plugin's server, resolved with the project's overrides.
const McpAppPluginPanelSource = {
  pluginId: McpPluginId,
  panelId: McpPluginPanelId,
  projectId: ProjectId,
};

/**
 * Thread items keep their original flat shape so older clients still decode;
 * plugin panels are told apart by `pluginId`.
 */
const fromSource = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Union([
    Schema.Struct({ ...McpAppThreadItemSource, ...fields }),
    Schema.Struct({ ...McpAppPluginPanelSource, ...fields }),
  ]);

export const isMcpAppPluginPanelSource = <Input extends object>(
  input: Input,
): input is Extract<Input, { readonly pluginId: McpPluginId }> => "pluginId" in input;

export const McpAppCallToolInput = fromSource({
  name: TrimmedNonEmptyString,
  arguments: Schema.Record(Schema.String, Schema.Unknown),
});
export type McpAppCallToolInput = typeof McpAppCallToolInput.Type;

export const McpAppCallToolResult = Schema.Struct({
  content: Schema.Array(Schema.Unknown),
  structuredContent: Schema.optional(Schema.Unknown),
  isError: Schema.optional(Schema.Boolean),
  _meta: Schema.optional(Schema.Unknown),
});
export type McpAppCallToolResult = typeof McpAppCallToolResult.Type;

export const McpAppToolInfoInput = fromSource({
  name: TrimmedNonEmptyString,
});
export type McpAppToolInfoInput = typeof McpAppToolInfoInput.Type;

export const McpAppToolInfo = Schema.Struct({
  callable: Schema.Boolean,
  readOnly: Schema.Boolean,
  title: Schema.optional(Schema.String),
  tool: Schema.optional(Schema.Unknown),
});
export type McpAppToolInfo = typeof McpAppToolInfo.Type;

export const McpAppReadResourceInput = fromSource({
  uri: TrimmedNonEmptyString,
});
export type McpAppReadResourceInput = typeof McpAppReadResourceInput.Type;

export const McpAppReadResourceResult = Schema.Struct({
  contents: Schema.Array(Schema.Unknown),
});
export type McpAppReadResourceResult = typeof McpAppReadResourceResult.Type;

/** Replaces prior context; no content clears it. Thread items only. */
export const McpAppUpdateModelContextInput = Schema.Struct({
  ...McpAppThreadItemSource,
  conversationThreadId: ThreadId,
  content: Schema.optional(Schema.Array(Schema.Unknown)),
  structuredContent: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type McpAppUpdateModelContextInput = typeof McpAppUpdateModelContextInput.Type;

/** Renders a plugin panel's view; the active thread rides along for thread-scoped panels. */
export const McpAppOpenPanelInput = Schema.Struct({
  ...McpAppPluginPanelSource,
  threadId: Schema.optionalKey(ThreadId),
});
export type McpAppOpenPanelInput = typeof McpAppOpenPanelInput.Type;

const McpAppCspSchema = Schema.Struct({
  connectDomains: Schema.optionalKey(Schema.Array(Schema.String)),
  resourceDomains: Schema.optionalKey(Schema.Array(Schema.String)),
  frameDomains: Schema.optionalKey(Schema.Array(Schema.String)),
  baseUriDomains: Schema.optionalKey(Schema.Array(Schema.String)),
});

const McpAppPermissionSchema = Schema.optionalKey(Schema.Struct({}));

export const McpAppOpenPanelResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ready"),
    attachmentId: TrimmedNonEmptyString,
    server: TrimmedNonEmptyString,
    resourceUri: TrimmedNonEmptyString,
    csp: Schema.optionalKey(McpAppCspSchema),
    permissions: Schema.optionalKey(
      Schema.Struct({
        camera: McpAppPermissionSchema,
        microphone: McpAppPermissionSchema,
        geolocation: McpAppPermissionSchema,
        clipboardWrite: McpAppPermissionSchema,
      }),
    ),
    prefersBorder: Schema.optionalKey(Schema.Boolean),
    /** The panel's opening tool call, delivered to the view as tool input and result. */
    toolCall: Schema.optionalKey(
      Schema.Struct({
        name: TrimmedNonEmptyString,
        arguments: Schema.Record(Schema.String, Schema.Unknown),
        result: McpAppCallToolResult,
      }),
    ),
  }),
  // The host renders "Sign in to <server>" in place of the view.
  Schema.Struct({
    status: Schema.Literal("needs-auth"),
    server: TrimmedNonEmptyString,
  }),
]);
export type McpAppOpenPanelResult = typeof McpAppOpenPanelResult.Type;

/** Where a plugin panel is shown; clients ask again when the active thread changes. */
export const McpAppPanelContextInput = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.optionalKey(ThreadId),
});
export type McpAppPanelContextInput = typeof McpAppPanelContextInput.Type;

/**
 * The project's (or thread's worktree's) directory and git state, sent to the
 * view in host context so a plugin can map the repository to its own records.
 */
export const McpAppPanelContext = Schema.Struct({
  cwd: Schema.optionalKey(Schema.String),
  git: Schema.optionalKey(
    Schema.Struct({
      branch: Schema.optionalKey(Schema.String),
      remotes: Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.String })),
    }),
  ),
});
export type McpAppPanelContext = typeof McpAppPanelContext.Type;

export const McpAppRequestErrorReason = Schema.Literals([
  "not-an-app",
  "plugin-unavailable",
  "needs-auth",
  "provider-unsupported",
  "session-stopped",
  "tool-not-callable",
  "unsupported-content",
  "request-failed",
]);
export type McpAppRequestErrorReason = typeof McpAppRequestErrorReason.Type;

export class McpAppRequestError extends Schema.TaggedError<McpAppRequestError>()(
  "McpAppRequestError",
  {
    threadId: Schema.optionalKey(ThreadId),
    pluginId: Schema.optionalKey(McpPluginId),
    reason: McpAppRequestErrorReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not-an-app":
        return "This tool call has no MCP app.";
      case "plugin-unavailable":
        return "This plugin panel isn't available. The plugin may be disabled, uninstalled, or switched off for this project.";
      case "needs-auth":
        return "Sign in to this plugin's server to use the panel.";
      case "provider-unsupported":
        return "This thread's provider cannot run MCP app requests.";
      case "session-stopped":
        return "The app's thread is not running. Send a message in the thread that created it to use the app again.";
      case "tool-not-callable":
        return "This app cannot call that tool.";
      case "unsupported-content":
        return "Only text and structured content are supported.";
      case "request-failed":
        return "The app's MCP server request failed.";
    }
  }
}
