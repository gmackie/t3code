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

import { mcpAppEnvironment, mcpPluginEnvironment } from "~/state/mcpApps";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { McpAppFrame, type McpAppFrameSource } from "../chat/McpAppFrame";
import { McpOAuthSignIn } from "../settings/McpOAuthSignIn";

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
  // A finished sign-in bumps this to open the panel again.
  const [attempt, setAttempt] = useState(0);
  const plugins = useEnvironmentQuery(
    mcpPluginEnvironment.list({ environmentId: props.environmentId, input: {} }),
  ).data;
  const transport = plugins?.find((plugin) => plugin.manifest.id === props.pluginId)?.manifest
    .mcpServer.transport;
  // Directory and git state follow the active thread without reopening the view.
  const panelContext = useEnvironmentQuery(
    mcpAppEnvironment.panelContext({
      environmentId: props.environmentId,
      input: {
        projectId: props.projectId,
        ...(props.threadId === undefined ? {} : { threadId: props.threadId }),
      },
    }),
  ).data;
  const cwd = panelContext?.cwd ?? props.cwd;
  const signsInWithOAuth = transport?.type === "http" && transport.auth?.type === "oauth";
  const { environmentId, pluginId, panelId, projectId } = props;

  // Opening runs the panel's opening tool on the server: once per panel and project, and again
  // after a sign-in (`attempt`). The active thread reaches an open view as host context instead.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- see above
  useEffect(() => {
    let current = true;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- see above; the thread id is read once per open
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
  }, [environmentId, pluginId, panelId, projectId, attempt]);

  switch (opened.status) {
    case "opening":
      return <PanelNotice>Opening…</PanelNotice>;
    case "failed":
      return <PanelNotice>{opened.message}</PanelNotice>;
    case "needs-auth":
      return (
        <div className="flex size-full flex-col items-center justify-center gap-3 p-4">
          <p className="text-center text-muted-foreground text-sm">
            Sign in to {opened.server} to use this panel.
          </p>
          {signsInWithOAuth ? (
            <McpOAuthSignIn
              environmentId={environmentId}
              projectId={projectId}
              server={opened.server}
              status={{ status: "signed-out" }}
              // The server checks permission when the sign-in starts.
              canManage
              onChanged={() => setAttempt((value) => value + 1)}
            />
          ) : null}
        </div>
      );
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
            ...(cwd === undefined ? {} : { cwd }),
            ...(panelContext?.git === undefined ? {} : { git: panelContext.git }),
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
