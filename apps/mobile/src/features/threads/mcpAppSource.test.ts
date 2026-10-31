import { McpPluginId, McpPluginPanelId, ProjectId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mcpAppSourceInput, mcpAppT3Context, type McpAppViewSource } from "./mcpAppSource";

const threadItem: McpAppViewSource = {
  kind: "thread-item",
  threadId: ThreadId.make("thread"),
  conversationThreadId: ThreadId.make("conversation"),
  itemId: TurnItemId.make("item"),
  revision: "1",
};
const panel: McpAppViewSource = {
  kind: "plugin-panel",
  pluginId: McpPluginId.make("com.example.board"),
  panelId: McpPluginPanelId.make("board"),
  projectId: ProjectId.make("project"),
};

describe("mcpAppSourceInput", () => {
  it("scopes thread apps to their tool call", () => {
    expect(mcpAppSourceInput(threadItem)).toEqual({ threadId: "thread", itemId: "item" });
  });

  it("scopes plugin panels to the plugin, panel and project, never the thread", () => {
    expect(mcpAppSourceInput({ ...panel, threadId: ThreadId.make("thread") })).toEqual({
      pluginId: "com.example.board",
      panelId: "board",
      projectId: "project",
    });
  });
});

describe("mcpAppT3Context", () => {
  it("is absent for thread apps", () => {
    expect(mcpAppT3Context(threadItem)).toBeUndefined();
  });

  it("tells a panel its project and, when open, its thread", () => {
    expect(mcpAppT3Context(panel)).toEqual({ projectId: "project" });
    expect(mcpAppT3Context({ ...panel, threadId: ThreadId.make("thread") })).toEqual({
      projectId: "project",
      threadId: "thread",
    });
  });
});
