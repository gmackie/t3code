import type {
  McpAppPanelContext,
  McpPluginId,
  McpPluginPanelId,
  ProjectId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import type { McpAppCallToolResult, McpAppHostContext } from "@t3tools/client-runtime/mcp-apps";

/**
 * Where an MCP app view came from. A thread item's app sizes itself in the
 * feed; a plugin panel fills its screen, needs no thread, and calls its own
 * plugin's tools without a prompt, since installing the plugin was consent.
 */
export type McpAppViewSource =
  | {
      readonly kind: "thread-item";
      readonly threadId: ThreadId;
      readonly conversationThreadId: ThreadId;
      readonly itemId: TurnItemId;
      readonly revision: string;
    }
  | {
      readonly kind: "plugin-panel";
      readonly pluginId: McpPluginId;
      readonly panelId: McpPluginPanelId;
      readonly projectId: ProjectId;
      /** The open thread, for thread-scoped panels. */
      readonly threadId?: ThreadId;
      /** The panel's opening tool call, delivered as the view's tool input and result. */
      readonly toolCall?: {
        readonly name: string;
        readonly arguments: unknown;
        readonly result: McpAppCallToolResult | undefined;
      };
    };

/** The source half of every mcpApps.callTool/toolInfo/readResource input. */
export function mcpAppSourceInput(source: McpAppViewSource) {
  return source.kind === "thread-item"
    ? { threadId: source.threadId, itemId: source.itemId }
    : { pluginId: source.pluginId, panelId: source.panelId, projectId: source.projectId };
}

/** A panel's T3 block: where it is shown, plus the server's directory and git state for it. */
export function mcpAppT3Context(
  source: McpAppViewSource,
  panelContext?: McpAppPanelContext,
): McpAppHostContext["t3"] {
  if (source.kind !== "plugin-panel") return undefined;
  return {
    projectId: source.projectId,
    ...(source.threadId === undefined ? {} : { threadId: source.threadId }),
    ...(panelContext?.cwd === undefined ? {} : { cwd: panelContext.cwd }),
    ...(panelContext?.git === undefined ? {} : { git: panelContext.git }),
  };
}
