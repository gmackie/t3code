import type {
  EnvironmentId,
  McpAppOpenPanelResult,
  McpPluginId,
  McpPluginPanelId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useState } from "react";

import { mcpAppEnvironment } from "~/state/mcpApps";
import { useAtomCommand } from "~/state/use-atom-command";
import { McpAppFrame, type McpAppFrameSource } from "../chat/McpAppFrame";

type Opened =
  | { readonly status: "opening" }
  | { readonly status: "failed"; readonly message: string }
  | Extract<McpAppOpenPanelResult, { status: "needs-auth" }>
  | {
      readonly status: "ready";
      readonly result: Extract<McpAppOpenPanelResult, { status: "ready" }>;
      readonly toolCall: Extract<McpAppFrameSource, { kind: "plugin-panel" }>["toolCall"];
    };

/**
 * A plugin's MCP Apps panel. Callers key it by plugin, panel and project and
 * mount it only while visible, so a hidden panel keeps no frame alive; a
 * thread change reaches the open view as host context, without a reload.
 */
export function PluginPanelView(props: {
  readonly environmentId: EnvironmentId;
  readonly pluginId: McpPluginId;
  readonly panelId: McpPluginPanelId;
  readonly projectId: ProjectId;
  readonly threadId?: ThreadId;
  readonly cwd?: string;
}) {
  const openPanel = useAtomCommand(mcpAppEnvironment.openPanel, { reportFailure: false });
  const [opened, setOpened] = useState<Opened>({ status: "opening" });
  const { environmentId, pluginId, panelId, projectId } = props;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opening runs the panel's opening tool on the server, once per panel and project
  useEffect(() => {
    let current = true;
    void openPanel({
      environmentId,
      input: {
        pluginId,
        panelId,
        projectId,
        ...(props.threadId === undefined ? {} : { threadId: props.threadId }),
      },
    }).then((result) => {
      if (!current) return;
      if (result._tag !== "Success") {
        const error = squashAtomCommandFailure(result);
        setOpened({
          status: "failed",
          message: error instanceof Error ? error.message : "The panel couldn't be opened.",
        });
        return;
      }
      const value = result.value;
      setOpened(
        value.status === "needs-auth"
          ? value
          : {
              status: "ready",
              result: value,
              toolCall:
                value.toolCall === undefined
                  ? undefined
                  : { arguments: value.toolCall.arguments, result: value.toolCall.result },
            },
      );
    });
    return () => {
      current = false;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The active thread reaches an open view as host context.
  }, [environmentId, pluginId, panelId, projectId]);

  switch (opened.status) {
    case "opening":
      return <PanelNotice>Opening…</PanelNotice>;
    case "failed":
      return <PanelNotice>{opened.message}</PanelNotice>;
    case "needs-auth":
      return <PanelNotice>Sign in to {opened.server} to use this panel.</PanelNotice>;
    case "ready": {
      const { result } = opened;
      return (
        <McpAppFrame
          key={result.attachmentId}
          environmentId={environmentId}
          source={{
            kind: "plugin-panel",
            pluginId,
            panelId,
            projectId,
            ...(props.threadId === undefined ? {} : { threadId: props.threadId }),
            ...(props.cwd === undefined ? {} : { cwd: props.cwd }),
            ...(opened.toolCall === undefined ? {} : { toolCall: opened.toolCall }),
          }}
          app={{
            attachmentId: result.attachmentId,
            server: result.server,
            tool: result.toolCall?.name ?? "",
            resourceUri: result.resourceUri,
            ...(result.csp === undefined ? {} : { csp: result.csp }),
            ...(result.permissions === undefined ? {} : { permissions: result.permissions }),
            ...(result.prefersBorder === undefined ? {} : { prefersBorder: result.prefersBorder }),
          }}
          onSendMessage={undefined}
        />
      );
    }
  }
}

function PanelNotice(props: { readonly children: React.ReactNode }) {
  return (
    <p className="flex size-full items-center justify-center p-4 text-center text-muted-foreground text-sm">
      {props.children}
    </p>
  );
}
