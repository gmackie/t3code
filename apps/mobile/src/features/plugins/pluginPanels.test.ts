import type { McpPluginEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pluginPanelChoices, pluginPanelRouteParams } from "./pluginPanels";

const entry = (
  id: string,
  enabled: boolean,
  panels: ReadonlyArray<{ readonly id: string; readonly scope: "thread" | "project" }>,
) =>
  ({
    enabled,
    manifest: {
      id,
      displayName: `${id} name`,
      contributes: {
        panels: panels.map((panel) => ({ ...panel, title: `${panel.id} title` })),
        commands: [],
      },
    },
  }) as unknown as McpPluginEntry;

describe("pluginPanelChoices", () => {
  const entries = [
    entry("com.example.board", true, [
      { id: "issue", scope: "thread" },
      { id: "board", scope: "project" },
    ]),
    entry("com.example.off", false, [{ id: "hidden", scope: "project" }]),
    entry("com.example.empty", true, []),
  ];

  it("lists every panel of enabled plugins when a thread is open", () => {
    expect(pluginPanelChoices(entries, { threadOpen: true }).map((choice) => choice.key)).toEqual([
      "com.example.board/issue",
      "com.example.board/board",
    ]);
  });

  it("leaves out thread panels when no thread is open", () => {
    expect(pluginPanelChoices(entries, { threadOpen: false }).map((choice) => choice.key)).toEqual([
      "com.example.board/board",
    ]);
  });

  it("is empty when no enabled plugin has panels", () => {
    expect(pluginPanelChoices(entries.slice(1), { threadOpen: true })).toEqual([]);
  });
});

describe("pluginPanelRouteParams", () => {
  const [issue, board] = pluginPanelChoices(
    [
      entry("com.example.board", true, [
        { id: "issue", scope: "thread" },
        { id: "board", scope: "project" },
      ]),
    ],
    { threadOpen: true },
  );
  const context = { environmentId: "env", projectId: "project", threadId: "thread" };

  it("passes the thread to a thread panel", () => {
    expect(pluginPanelRouteParams(issue!, context)).toEqual({
      environmentId: "env",
      pluginId: "com.example.board",
      panelId: "issue",
      projectId: "project",
      threadId: "thread",
    });
  });

  it("opens a project panel with only the project", () => {
    expect(pluginPanelRouteParams(board!, context)).not.toHaveProperty("threadId");
  });
});
