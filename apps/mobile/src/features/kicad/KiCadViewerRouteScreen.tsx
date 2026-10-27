import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { kicadState } from "../../state/kicad";
import { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type Ref,
} from "react";
import { ActivityIndicator, Linking, Pressable, View } from "react-native";
import { WebView } from "react-native-webview";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";

import { AppText as Text } from "../../components/ui/AppText";
import { LoadingStrip } from "../../components/ui/LoadingStrip";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { usePreparedConnection } from "../../state/session";

type Props = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly cwd: string;
}>;

type KiCadWebViewRequest = {
  readonly isTopFrame?: boolean;
  readonly url: string;
};

type KiCadWebViewProps = {
  readonly allowsBackForwardNavigationGestures?: boolean;
  readonly allowsFullscreenVideo?: boolean;
  readonly injectedJavaScriptBeforeContentLoaded?: string;
  readonly onContentProcessDidTerminate?: () => void;
  readonly onError?: () => void;
  readonly onHttpError?: (event: { nativeEvent: { statusCode: number; url: string } }) => void;
  readonly onLoadEnd?: () => void;
  readonly onLoadProgress?: (event: { nativeEvent: { progress: number } }) => void;
  readonly onLoadStart?: () => void;
  readonly onShouldStartLoadWithRequest?: (request: KiCadWebViewRequest) => boolean;
  readonly originWhitelist?: readonly string[];
  readonly ref?: Ref<WebView>;
  readonly renderLoading?: () => ReactNode;
  readonly setSupportMultipleWindows?: boolean;
  readonly source: { readonly uri: string };
  readonly startInLoadingState?: boolean;
  readonly style?: { backgroundColor: string; flex: number };
};

// react-native-webview's props collapse to `never` against this React Native
// types combo after the upstream rebase. The CAD viewer still needs them.
const KiCadWebView = WebView as unknown as ComponentType<KiCadWebViewProps>;

export function KiCadViewerRouteScreen({ route }: Props) {
  const navigation = useNavigation();
  const { cwd } = route.params;
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const connection = usePreparedConnection(environmentId);
  const mintSession = useAtomQueryRunner(kicadState.session, {
    refresh: true,
    reportFailure: false,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  // Each change of target or retry is a new request; a result only counts for the request that made it.
  const sessionRequest = useMemo(
    () => ({ connection, cwd, environmentId, mintSession, refreshKey }),
    [connection, cwd, environmentId, mintSession, refreshKey],
  );
  const [viewer, setViewer] = useState<{
    request: typeof sessionRequest;
    session: { token: string; expiresAt: number } | null;
    error: string | null;
  } | null>(null);
  const current = viewer?.request === sessionRequest ? viewer : null;
  const session = current?.session ?? null;
  const error = Option.isNone(connection)
    ? "Reconnect to this environment to open the KiCad viewer."
    : (current?.error ?? null);
  const fail = (message: string) =>
    setViewer({ request: sessionRequest, session: null, error: message });
  const showError = (message: string) =>
    setViewer((previous) => ({
      request: sessionRequest,
      session: previous?.request === sessionRequest ? previous.session : null,
      error: message,
    }));
  const [progress, setProgress] = useState(0);
  const webViewRef = useRef<WebView>(null);
  const theme = useUniwindTheme();
  const { themeAppearance } = useAppearancePreferences();

  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);
  useEffect(() => {
    if (Option.isNone(sessionRequest.connection)) return;
    const controller = new AbortController();
    void sessionRequest
      .mintSession({ environmentId: sessionRequest.environmentId, cwd: sessionRequest.cwd })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        setViewer({ request: sessionRequest, session: result.value, error: null });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setViewer({
            request: sessionRequest,
            session: null,
            error: cause instanceof Error ? cause.message : "Unable to open the KiCad viewer.",
          });
      });
    return () => controller.abort();
  }, [sessionRequest]);

  useEffect(() => {
    if (!session) return;
    const remaining = session.expiresAt - Date.now() - 60_000;
    const timer = setTimeout(retry, Math.max(1_000, remaining));
    return () => clearTimeout(timer);
  }, [retry, session]);

  const viewerUrl = useMemo(() => {
    if (!session || Option.isNone(connection)) return null;
    const url = new URL(`${connection.value.httpBaseUrl.replace(/\/$/, "")}/kicad.html`);
    url.hash = new URLSearchParams({
      api: connection.value.httpBaseUrl,
      token: session.token,
      view: "pcb",
      embedded: "1",
    }).toString();
    return url.toString();
  }, [connection, session]);
  const viewerOrigin = useMemo(() => (viewerUrl ? new URL(viewerUrl).origin : null), [viewerUrl]);
  const themeScript = useMemo(() => {
    const variables = {
      "--background": theme["--color-screen"],
      "--foreground": theme["--color-foreground"],
      "--card": theme["--color-card"],
      "--card-foreground": theme["--color-foreground"],
      "--muted": theme["--color-subtle"],
      "--muted-foreground": theme["--color-foreground-muted"],
      "--accent": theme["--color-subtle-strong"],
      "--accent-foreground": theme["--color-foreground"],
      "--border": theme["--color-border"],
    };
    return `(() => { const vars = ${JSON.stringify(variables)}; for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(key, value); document.documentElement.classList.toggle("dark", ${themeAppearance === "dark"}); })(); true;`;
  }, [theme, themeAppearance]);

  useEffect(() => {
    if (viewerUrl) webViewRef.current?.injectJavaScript(themeScript);
  }, [themeScript, viewerUrl]);

  return (
    <View className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ title: "CAD" }} />
      <View className="flex-row items-center gap-1 border-b border-border px-3 py-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch to Code mode"
          onPress={() => navigation.goBack()}
          className="rounded-md px-4 py-2"
        >
          <Text className="text-foreground-muted">Code</Text>
        </Pressable>
        <View
          className="rounded-md bg-subtle-strong px-4 py-2"
          accessibilityRole="text"
          accessibilityLabel="CAD mode, selected"
        >
          <Text>CAD</Text>
        </View>
      </View>
      {progress > 0 && progress < 1 ? <LoadingStrip progress={progress} /> : null}
      {viewerUrl ? (
        <KiCadWebView
          ref={webViewRef}
          source={{ uri: viewerUrl }}
          originWhitelist={viewerOrigin ? ["http://*", "https://*", "about:blank", "blob:*"] : []}
          allowsBackForwardNavigationGestures={false}
          allowsFullscreenVideo
          setSupportMultipleWindows={false}
          startInLoadingState
          injectedJavaScriptBeforeContentLoaded={themeScript}
          onShouldStartLoadWithRequest={(request) => {
            if (
              request.url === "about:blank" ||
              request.url.startsWith("blob:") ||
              (viewerOrigin !== null && request.url.startsWith(`${viewerOrigin}/`))
            )
              return true;
            if (/^https?:\/\//i.test(request.url)) {
              // Analysis dashboards load in their own frame; full-page links open externally.
              if (request.isTopFrame === false) return true;
              void Linking.openURL(request.url).catch(() => {
                showError("Unable to open the analysis dashboard in your browser.");
              });
              return false;
            }
            showError("Navigation outside the KiCad viewer was blocked.");
            return false;
          }}
          onLoadProgress={(event) => setProgress(event.nativeEvent.progress)}
          onLoadStart={() => setProgress(0.05)}
          onLoadEnd={() => {
            setProgress(0);
            webViewRef.current?.injectJavaScript(themeScript);
          }}
          onHttpError={(event) => {
            if (event.nativeEvent.url.split("#")[0] !== viewerUrl.split("#")[0]) return;
            setProgress(0);
            fail(`The KiCad viewer returned status ${event.nativeEvent.statusCode}.`);
          }}
          onError={() => {
            setProgress(0);
            fail("The KiCad viewer could not be loaded.");
          }}
          onContentProcessDidTerminate={() => {
            fail("The KiCad viewer stopped responding.");
          }}
          renderLoading={() => (
            <View className="absolute inset-0 items-center justify-center bg-sheet">
              <ActivityIndicator />
            </View>
          )}
          style={{ flex: 1, backgroundColor: "transparent" }}
        />
      ) : (
        <View className="flex-1 items-center justify-center gap-3 px-6">
          {error ? (
            <>
              <Text className="text-center text-sm text-foreground-muted">{error}</Text>
              <Pressable className="rounded-md bg-accent px-4 py-2" onPress={retry}>
                <Text className="text-sm font-t3-bold text-foreground">Retry</Text>
              </Pressable>
              <Text className="text-sm text-foreground-muted">
                Use the back button to leave the viewer.
              </Text>
            </>
          ) : (
            <>
              <ActivityIndicator />
              <Text className="text-sm text-foreground-muted">Opening KiCad viewer…</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}
