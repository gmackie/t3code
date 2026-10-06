import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { gameState } from "../../state/game";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
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
import { ActivityIndicator, AppState, PixelRatio, Platform, Pressable, View } from "react-native";
import { WebView } from "react-native-webview";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";

import { AppText as Text } from "../../components/AppText";
import { LoadingStrip } from "../../components/LoadingStrip";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { usePreparedConnection } from "../../state/session";

import { mobileHtmlRenderTheme } from "../../lib/htmlRenderTheme";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

type Props = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly cwd: string;
}>;

type GameWebViewRequest = {
  readonly isTopFrame?: boolean;
  readonly url: string;
};

type GameWebViewProps = {
  readonly allowsBackForwardNavigationGestures?: boolean;
  readonly allowsFullscreenVideo?: boolean;
  readonly injectedJavaScriptBeforeContentLoaded?: string;
  readonly onContentProcessDidTerminate?: () => void;
  readonly onError?: () => void;
  readonly onHttpError?: (event: { nativeEvent: { statusCode: number; url: string } }) => void;
  readonly onLoadEnd?: () => void;
  readonly onLoadProgress?: (event: { nativeEvent: { progress: number } }) => void;
  readonly onLoadStart?: () => void;
  readonly onShouldStartLoadWithRequest?: (request: GameWebViewRequest) => boolean;
  readonly originWhitelist?: readonly string[];
  readonly ref?: Ref<WebView>;
  readonly renderLoading?: () => ReactNode;
  readonly setSupportMultipleWindows?: boolean;
  readonly source: { readonly uri: string };
  readonly startInLoadingState?: boolean;
  readonly style?: { backgroundColor: string; flex: number };
};

// react-native-webview's props collapse to `never` against this React Native
// types combo after the upstream rebase. The Game viewer still needs them.
const GameWebView = WebView as unknown as ComponentType<GameWebViewProps>;

export function GameViewerRouteScreen({ route }: Props) {
  const navigation = useNavigation();
  const { themeId, themeAppearance, themeVariables, systemColorsActive } =
    useAppearancePreferences();
  const theme = useMemo(() => {
    const palette = mobileHtmlRenderTheme({
      themeId,
      appearance: themeAppearance,
      variables: themeVariables,
      systemColors: systemColorsActive,
      platform: Platform.OS,
    });
    return {
      ...palette,
      variables: {
        ...palette.variables,
        "--game-font-size": `${16 * PixelRatio.getFontScale()}px`,
      },
    };
  }, [themeId, themeAppearance, themeVariables, systemColorsActive]);
  const [initialTheme] = useState(theme);
  const { cwd } = route.params;
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const connection = usePreparedConnection(environmentId);
  const [lastEndpoint, setLastEndpoint] = useState<{
    environmentId: EnvironmentId;
    httpBaseUrl: string;
  } | null>(null);
  const viewerEndpoint =
    lastEndpoint?.environmentId === environmentId ? lastEndpoint.httpBaseUrl : null;
  // A WebSocket wakeup briefly clears the prepared connection. The viewer has
  // its own HTTP ticket and must stay mounted to retain its target and history.
  if (
    Option.isSome(connection) &&
    (lastEndpoint?.environmentId !== environmentId ||
      lastEndpoint.httpBaseUrl !== connection.value.httpBaseUrl)
  ) {
    setLastEndpoint({ environmentId, httpBaseUrl: connection.value.httpBaseUrl });
  }
  const mintSession = useAtomQueryRunner(gameState.session, {
    refresh: true,
    reportFailure: false,
  });
  const [session, setSession] = useState<{
    token: string;
    expiresAt: number;
    httpBaseUrl: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [progress, setProgress] = useState(0);
  const webViewRef = useRef<WebView>(null);

  const postTheme = useCallback(() => {
    webViewRef.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent('t3-game-theme', { detail: ${JSON.stringify(theme)} })); true;`,
    );
  }, [theme]);
  useEffect(postTheme, [postTheme]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      webViewRef.current?.injectJavaScript(
        `window.dispatchEvent(new CustomEvent('t3-game-visibility', { detail: ${state === "active"} })); true;`,
      );
    });
    return () => subscription.remove();
  }, []);

  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setSession(null);
    setError(null);
    if (!viewerEndpoint) {
      setError("Reconnect to this environment to open the Game viewer.");
      return () => controller.abort();
    }
    void mintSession({ environmentId, cwd, threadId: ThreadId.make(route.params.threadId) })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        setSession({ ...result.value, httpBaseUrl: viewerEndpoint });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Unable to open the Game viewer.");
      });
    return () => controller.abort();
  }, [viewerEndpoint, cwd, environmentId, mintSession, refreshKey, route.params.threadId]);

  useEffect(() => {
    if (!session) return;
    const remaining = session.expiresAt - Date.now() - 60_000;
    const timer = setTimeout(retry, Math.max(1_000, remaining));
    return () => clearTimeout(timer);
  }, [retry, session]);

  const viewerUrl = useMemo(() => {
    if (!session || !viewerEndpoint) return null;
    const url = new URL(`${session.httpBaseUrl.replace(/\/$/, "")}/api/game/viewer`);
    url.hash = new URLSearchParams({
      ticket: session.token,
      gameTheme: JSON.stringify(initialTheme),
    }).toString();
    return url.toString();
  }, [viewerEndpoint, session, initialTheme]);
  const viewerOrigin = useMemo(() => (viewerUrl ? new URL(viewerUrl).origin : null), [viewerUrl]);
  return (
    <View className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ title: "Unity game" }} />
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
          accessibilityLabel="Game mode, selected"
        >
          <Text>Game</Text>
        </View>
      </View>
      {progress > 0 && progress < 1 ? <LoadingStrip progress={progress} /> : null}
      {viewerUrl ? (
        <GameWebView
          ref={webViewRef}
          source={{ uri: viewerUrl }}
          originWhitelist={viewerOrigin ? ["http://*", "https://*", "about:blank", "blob:*"] : []}
          allowsBackForwardNavigationGestures={false}
          allowsFullscreenVideo
          setSupportMultipleWindows={false}
          startInLoadingState
          onShouldStartLoadWithRequest={(request) => {
            if (
              request.url === "about:blank" ||
              request.url.startsWith("blob:") ||
              (viewerOrigin !== null && request.url.startsWith(`${viewerOrigin}/`))
            )
              return true;
            setError("Navigation outside the Game viewer was blocked.");
            return false;
          }}
          onLoadProgress={(event) => setProgress(event.nativeEvent.progress)}
          onLoadStart={() => setProgress(0.05)}
          onLoadEnd={() => {
            setProgress(0);
            postTheme();
            webViewRef.current?.injectJavaScript(
              `window.dispatchEvent(new CustomEvent('t3-game-visibility', { detail: ${AppState.currentState === "active"} })); true;`,
            );
          }}
          onHttpError={(event) => {
            if (event.nativeEvent.url.split("#")[0] !== viewerUrl.split("#")[0]) return;
            setProgress(0);
            setSession(null);
            setError(`The Game viewer returned status ${event.nativeEvent.statusCode}.`);
          }}
          onError={() => {
            setProgress(0);
            setSession(null);
            setError("The Game viewer could not be loaded.");
          }}
          onContentProcessDidTerminate={() => {
            setSession(null);
            setError("The Game viewer stopped responding.");
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
              <Text className="text-sm text-foreground-muted">Opening Game viewer…</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}
