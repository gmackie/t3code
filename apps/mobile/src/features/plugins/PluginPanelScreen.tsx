import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  EnvironmentId,
  McpPluginId,
  McpPluginPanelId,
  ProjectId,
  ThreadId,
  type McpAppOpenPanelResult,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { McpAppReference } from "@t3tools/shared/mcpApp";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { mcpAppEnvironment, mcpPluginEnvironment } from "../../state/mcpApps";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { McpAppView } from "../threads/McpAppWebView";
import { useMcpOAuthSignIn } from "../tools/mcpOAuthSignIn";
import type { McpAppViewSource } from "../threads/mcpAppSource";

type PluginPanelScreenProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly pluginId: string;
  readonly panelId: string;
  readonly projectId: string;
  readonly threadId?: string;
}>;

// Built once per open; a new source or app would rebuild the view's host.
type PanelState =
  | { readonly _tag: "loading" }
  | { readonly _tag: "failed"; readonly message: string }
  | { readonly _tag: "needs-auth"; readonly server: string }
  | { readonly _tag: "ready"; readonly source: McpAppViewSource; readonly app: McpAppReference };

function panelView(
  source: Extract<McpAppViewSource, { readonly kind: "plugin-panel" }>,
  result: McpAppOpenPanelResult,
): PanelState {
  if (result.status === "needs-auth") return { _tag: "needs-auth", server: result.server };
  return {
    _tag: "ready",
    source: result.toolCall === undefined ? source : { ...source, toolCall: result.toolCall },
    app: {
      attachmentId: result.attachmentId,
      server: result.server,
      // Names the HTML snapshot's file; a panel without an opening tool has none.
      tool: result.toolCall?.name ?? source.panelId,
      resourceUri: result.resourceUri,
      ...(result.csp === undefined ? {} : { csp: result.csp }),
      ...(result.permissions === undefined ? {} : { permissions: result.permissions }),
      ...(result.prefersBorder === undefined ? {} : { prefersBorder: result.prefersBorder }),
    },
  };
}

export function PluginPanelScreen({ route }: PluginPanelScreenProps) {
  const params = route.params;
  const environmentId = EnvironmentId.make(params.environmentId);
  const plugins = useEnvironmentQuery(mcpPluginEnvironment.list({ environmentId, input: {} }));
  const manifest = plugins.data?.find((entry) => entry.manifest.id === params.pluginId)?.manifest;
  const panelTitle = manifest?.contributes.panels.find(
    (panel) => panel.id === params.panelId,
  )?.title;
  const transport = manifest?.mcpServer.transport;
  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions options={{ title: panelTitle ?? "Plugin" }} />
      {/* Changed params open a different panel, which needs its own view and opening call. */}
      <PluginPanel
        key={[params.pluginId, params.panelId, params.projectId, params.threadId ?? ""].join("\n")}
        environmentId={environmentId}
        pluginId={McpPluginId.make(params.pluginId)}
        panelId={McpPluginPanelId.make(params.panelId)}
        projectId={ProjectId.make(params.projectId)}
        {...(params.threadId === undefined ? {} : { threadId: ThreadId.make(params.threadId) })}
        signsInWithOAuth={transport?.type === "http" && transport.oauth !== undefined}
      />
    </View>
  );
}

function PluginPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly pluginId: McpPluginId;
  readonly panelId: McpPluginPanelId;
  readonly projectId: ProjectId;
  readonly threadId?: ThreadId;
  /** Only an OAuth server can be signed in to from here; others just report the state. */
  readonly signsInWithOAuth: boolean;
}) {
  const navigation = useNavigation();
  const signIn = useMcpOAuthSignIn(props.environmentId);
  const [signingIn, setSigningIn] = useState(false);
  const [signInMessage, setSignInMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [state, setState] = useState<PanelState>({ _tag: "loading" });
  const openPanel = useAtomCommand(mcpAppEnvironment.openPanel, { reportFailure: false });
  const open = useEffectEvent((isActive: () => boolean) => {
    const input = {
      pluginId: props.pluginId,
      panelId: props.panelId,
      projectId: props.projectId,
      ...(props.threadId === undefined ? {} : { threadId: props.threadId }),
    };
    void openPanel({ environmentId: props.environmentId, input }).then((result) => {
      if (!isActive()) return;
      if (result._tag === "Success") {
        setState(panelView({ kind: "plugin-panel", ...input }, result.value));
        return;
      }
      const error = squashAtomCommandFailure(result);
      setState({
        _tag: "failed",
        message:
          error instanceof Error && error.message.trim() !== ""
            ? error.message
            : "This panel could not be opened.",
      });
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opening a panel is a server request that runs once per mounted panel
  useEffect(() => {
    mounted.current = true;
    open(() => mounted.current);
    return () => {
      mounted.current = false;
    };
  }, []);

  const signInAndReopen = (server: string) => {
    if (signIn === null) return;
    setSigningIn(true);
    setSignInMessage(null);
    void signIn(server, props.projectId).then((outcome) => {
      if (!mounted.current) return;
      setSigningIn(false);
      if (outcome.status === "connected") {
        setState({ _tag: "loading" });
        open(() => mounted.current);
      } else if (outcome.status === "failed") {
        setSignInMessage(outcome.message);
      }
    });
  };

  const close = () => {
    if (navigation.isFocused() && navigation.canGoBack()) navigation.goBack();
  };

  return (
    <View
      className="flex-1"
      style={{ paddingBottom: insets.bottom }}
      onLayout={(event) =>
        setSize({
          width: Math.round(event.nativeEvent.layout.width),
          height: Math.round(event.nativeEvent.layout.height - insets.bottom),
        })
      }
    >
      {state._tag === "loading" ? (
        <View className="flex-1 items-center justify-center">
          <AppActivityIndicator />
        </View>
      ) : state._tag === "failed" ? (
        <Text className="m-6 text-sm text-foreground-muted">{state.message}</Text>
      ) : state._tag === "needs-auth" ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-base font-semibold text-foreground">
            Sign in to {state.server}
          </Text>
          <Text className="mt-1 text-center text-sm text-foreground-muted">
            This panel needs you to sign in to its server first.
          </Text>
          {props.signsInWithOAuth && signIn !== null ? (
            <View className="mt-4">
              <Button
                label="Sign in"
                loading={signingIn}
                disabled={signingIn}
                onPress={() => signInAndReopen(state.server)}
              />
            </View>
          ) : null}
          {signInMessage === null ? null : (
            <Text className="mt-3 text-center text-sm text-foreground-muted">{signInMessage}</Text>
          )}
        </View>
      ) : size.width > 0 ? (
        <McpAppView
          environmentId={props.environmentId}
          source={state.source}
          app={state.app}
          width={size.width}
          height={size.height}
          onClose={close}
        />
      ) : null}
    </View>
  );
}
