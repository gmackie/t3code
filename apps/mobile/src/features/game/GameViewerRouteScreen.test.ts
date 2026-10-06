import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Option from "effect/Option";

const fixture = vi.hoisted(() => ({
  connection: undefined as unknown,
  mint: vi.fn(),
  mounts: 0,
  unmounts: 0,
}));
vi.mock("../../state/session", () => ({ usePreparedConnection: () => fixture.connection }));
vi.mock("../../state/game", () => ({ gameState: { session: {} } }));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => fixture.mint }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: unknown }) => children,
  Pressable: () => null,
  ActivityIndicator: () => null,
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
}));
vi.mock("react-native-webview", () => ({
  WebView: () => {
    useEffect(() => {
      fixture.mounts++;
      return () => {
        fixture.unmounts++;
      };
    }, []);
    return null;
  },
}));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ goBack() {} }) }));
vi.mock("../../components/AppText", () => ({ AppText: () => null }));
vi.mock("../../components/LoadingStrip", () => ({ LoadingStrip: () => null }));
vi.mock("../../native/StackHeader", () => ({ NativeStackScreenOptions: () => null }));
import { GameViewerRouteScreen } from "./GameViewerRouteScreen";

let root: Root;
const route = {
  key: "game",
  name: "Game",
  params: { environmentId: "env", threadId: "thread", cwd: "/fixture" },
};
const render = () =>
  act(async () => {
    root.render(createElement(GameViewerRouteScreen, { route }));
  });
beforeEach(() => {
  fixture.connection = Option.some({ httpBaseUrl: "https://first.test" });
  fixture.mounts = 0;
  fixture.unmounts = 0;
  fixture.mint.mockReset().mockResolvedValue({
    _tag: "Success",
    value: { token: "ticket", expiresAt: Date.now() + 3600000 },
  });
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {} };
  const container = {
    nodeType: 1,
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { document, HTMLIFrameElement: EventTarget });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(container as unknown as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps the live viewer mounted through connection loss and same-origin wakeup", async () => {
  await render();
  expect(fixture.mounts).toBe(1);
  fixture.connection = Option.none();
  await render();
  expect(fixture.unmounts).toBe(0);
  fixture.connection = Option.some({ httpBaseUrl: "https://first.test" });
  await render();
  expect(fixture.mounts).toBe(1);
  expect(fixture.mint).toHaveBeenCalledTimes(1);
});

it("mints a new viewer when the environment route changes origin", async () => {
  await render();
  fixture.connection = Option.some({ httpBaseUrl: "https://second.test" });
  await render();
  expect(fixture.mint).toHaveBeenCalledTimes(2);
  expect(fixture.unmounts).toBe(1);
});
