import { McpAppRequestError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, useLayoutEffect, type ReactNode, type RefCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type ViewMessage = { readonly nativeEvent: { readonly data: string } };
const mocks = vi.hoisted(() => ({
  openPanel: vi.fn(),
  callTool: vi.fn(),
  toolInfo: vi.fn(),
  readResource: vi.fn(),
  signIn: vi.fn(),
  view: null as null | {
    readonly source: { readonly html: string };
    readonly onMessage: (event: ViewMessage) => void;
  },
  messages: [] as Array<{
    readonly id?: unknown;
    readonly result?: unknown;
    readonly error?: unknown;
  }>,
}));

vi.mock("react-native", () => ({
  Platform: { OS: process.env.T3_MOBILE_TEST_PLATFORM === "android" ? "android" : "ios" },
  View: (props: { readonly children?: ReactNode; readonly onLayout?: (event: object) => void }) => {
    useLayoutEffect(() => {
      props.onLayout?.({ nativeEvent: { layout: { width: 390, height: 800 } } });
    }, []);
    return <div>{props.children}</div>;
  },
}));
vi.mock("react-native-webview", () => ({
  WebView: (props: {
    readonly ref: RefCallback<unknown>;
    readonly source: { readonly html: string };
    readonly onMessage: (event: ViewMessage) => void;
  }) => {
    mocks.view = props;
    useLayoutEffect(
      () =>
        props.ref({
          injectJavaScript: (script: string) => {
            const json = script.slice(script.indexOf("(") + 1, script.lastIndexOf(");true;"));
            mocks.messages.push(JSON.parse(json));
          },
        }),
      [props.ref],
    );
    return <div role="region" aria-label="Plugin app" />;
  },
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true, goBack: vi.fn() }),
}));
vi.mock("@react-navigation/elements", async () => {
  const { createContext } = await import("react");
  return { HeaderHeightContext: createContext(44) };
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "test" } } }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: (props: { readonly children?: ReactNode }) => <span>{props.children}</span>,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: (props: {
    readonly label: string;
    readonly disabled?: boolean;
    readonly onPress: () => void;
  }) => (
    <button disabled={props.disabled} onClick={props.onPress}>
      {props.label}
    </button>
  ),
}));
vi.mock("../../components/ui/AppActivityIndicator", () => ({
  AppActivityIndicator: () => <div role="status">Opening panel</div>,
}));
vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../../native/StackHeader", () => ({ NativeStackScreenOptions: () => null }));
vi.mock("../../components/ui/AppBar", () => ({
  AppBar: (props: { readonly title: string }) => <h1>{props.title}</h1>,
}));
vi.mock("../../state/mcpApps", () => ({
  mcpAppEnvironment: {
    openPanel: "openPanel",
    callTool: "callTool",
    toolInfo: "toolInfo",
    readResource: "readResource",
    updateModelContext: "updateModelContext",
    panelContext: () => "context",
    toolInfoQuery: () => "info",
  },
  mcpPluginEnvironment: { list: () => "plugins" },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: keyof typeof mocks) => mocks[command],
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: string) => ({
    data:
      query === "plugins"
        ? [
            {
              manifest: {
                id: "com.example.board",
                mcpServer: { transport: { type: "http", auth: { type: "oauth" } } },
                contributes: { panels: [{ id: "board", title: "Board" }] },
              },
            },
          ]
        : null,
  }),
}));
vi.mock("../tools/mcpOAuthSignIn", () => ({ useMcpOAuthSignIn: () => mocks.signIn }));
vi.mock("../../state/assets", () => ({
  useAssetUrlState: () => ({ _tag: "Success", url: "https://t3.example/view" }),
}));
vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: { subscribe: vi.fn() } }));
vi.mock("../../state/entities", () => ({ useThreadShell: () => null }));
vi.mock("../../state/orchestration", () => ({ orchestrationEnvironment: {} }));
vi.mock("../../state/thread-outbox", () => ({ enqueueThreadOutboxMessage: vi.fn() }));
vi.mock("../../lib/attachmentDownload", () => ({ shareGeneratedAttachment: vi.fn() }));
vi.mock("../../lib/openExternalUrl", () => ({ tryOpenExternalUrl: vi.fn() }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "bridge-secret" }));
vi.mock("../../lib/htmlRenderTheme", () => ({
  mobileHtmlRenderTheme: () => ({ appearance: "dark", variables: {} }),
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({
    themeId: "default",
    themeAppearance: "dark",
    themeVariables: {},
    systemColorsActive: false,
  }),
}));

import { PluginPanelScreen } from "./PluginPanelScreen";

const params = {
  environmentId: "remote",
  pluginId: "com.example.board",
  panelId: "board",
  projectId: "project",
};
const ready = {
  status: "ready",
  attachmentId: "view",
  server: "board-server",
  resourceUri: "ui://board/view",
};
const needsAuth = () =>
  AsyncResult.failure(Cause.fail(new McpAppRequestError({ reason: "needs-auth" })));
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.messages.length = 0;
  mocks.openPanel.mockResolvedValue(AsyncResult.success(ready));
  mocks.toolInfo.mockResolvedValue(AsyncResult.success({ callable: true, readOnly: true }));
  mocks.callTool.mockResolvedValue(AsyncResult.success({ content: [] }));
  mocks.readResource.mockResolvedValue(AsyncResult.success({ contents: [] }));
  mocks.signIn.mockResolvedValue({ status: "connected" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  mocks.view = null;
});

async function render(environmentId = "remote") {
  await act(() =>
    root.render(<PluginPanelScreen route={{ params: { ...params, environmentId } }} />),
  );
}

function send(message: object) {
  const view = mocks.view!;
  const secret = JSON.parse(/,secret=("[^"]+")/.exec(view.source.html)![1]!);
  view.onMessage({
    nativeEvent: {
      data: JSON.stringify({ secret, active: true, message: { jsonrpc: "2.0", ...message } }),
    },
  });
}

async function initialize() {
  await act(async () => {
    send({ id: "init", method: "ui/initialize", params: {} });
    send({ method: "ui/notifications/initialized" });
  });
}

describe("server-installed mobile plugin panels", () => {
  it("returns an open panel to sign-in when a tool loses authorization, then reopens after signing in", async () => {
    await render();
    await initialize();
    mocks.callTool.mockResolvedValueOnce(needsAuth());
    await act(async () =>
      send({ id: "refresh", method: "tools/call", params: { name: "refresh", arguments: {} } }),
    );
    expect(container.textContent).toContain("Sign in to board-server");
    expect(container.querySelector('[aria-label="Plugin app"]')).toBeNull();
    await act(() => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector('[aria-label="Plugin app"]')).not.toBeNull();
    expect(mocks.signIn.mock.calls[0]?.slice(0, 2)).toEqual(["board-server", "project"]);
    expect(mocks.openPanel).toHaveBeenCalledTimes(2);
  });

  it("returns to sign-in if the tool lookup loses authorization before a call", async () => {
    await render();
    await initialize();
    mocks.toolInfo.mockResolvedValueOnce(needsAuth());
    await act(async () =>
      send({ id: "refresh", method: "tools/call", params: { name: "refresh", arguments: {} } }),
    );
    expect(container.textContent).toContain("Sign in to board-server");
    expect(mocks.callTool).not.toHaveBeenCalled();
  });

  it("returns to sign-in if reading a resource loses authorization", async () => {
    await render();
    await initialize();
    mocks.readResource.mockResolvedValueOnce(needsAuth());
    await act(async () =>
      send({ id: "read", method: "resources/read", params: { uri: "ui://board/more" } }),
    );
    expect(container.textContent).toContain("Sign in to board-server");
    expect(mocks.readResource).toHaveBeenCalledWith({
      environmentId: "remote",
      input: {
        pluginId: params.pluginId,
        panelId: "board",
        projectId: "project",
        uri: "ui://board/more",
      },
    });
  });

  it("keeps ordinary tool failures in the app instead of starting a new sign-in", async () => {
    await render();
    await initialize();
    mocks.callTool.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new McpAppRequestError({ reason: "request-failed" }))),
    );
    await act(async () =>
      send({ id: "refresh", method: "tools/call", params: { name: "refresh", arguments: {} } }),
    );
    expect(container.querySelector('[aria-label="Plugin app"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Sign in to");
    expect(mocks.messages.find((message) => message.id === "refresh")?.error).toBeDefined();
  });

  it("reopens against the new environment when two machines have the same project and plugin ids", async () => {
    await render();
    await render("another-remote");
    expect(mocks.openPanel).toHaveBeenLastCalledWith({
      environmentId: "another-remote",
      input: { pluginId: params.pluginId, panelId: "board", projectId: "project" },
    });
    expect(mocks.openPanel).toHaveBeenCalledTimes(2);
  });
});
