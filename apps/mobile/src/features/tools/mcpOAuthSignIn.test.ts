import type { McpOAuthSignInEvent } from "@t3tools/contracts";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  signIn: vi.fn(),
  openBrowser: vi.fn(),
  dismissBrowser: vi.fn(),
  platform: "android",
  appStateListener: null as null | ((state: string) => void),
  removeAppStateListener: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      mocks.appStateListener = listener;
      return { remove: mocks.removeAppStateListener };
    },
  },
}));
vi.mock("expo-web-browser", () => ({
  openBrowserAsync: mocks.openBrowser,
  dismissBrowser: mocks.dismissBrowser,
}));
vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: { subscribe: mocks.subscribe } }));
vi.mock("../../state/server", () => ({ serverEnvironment: { mcpOAuthSignIn: mocks.signIn } }));
vi.mock("../../state/session", () => ({ usePreparedConnection: () => null }));

import { signInToMcpServer } from "./mcpOAuthSignIn";

const input = {
  environmentId: EnvironmentId.make("remote"),
  httpBaseUrl: "https://t3.example/path",
  server: "forgegraph",
  projectId: ProjectId.make("project"),
};
let emit: (result: AsyncResult.AsyncResult<McpOAuthSignInEvent, unknown>) => void;
const authorize = () =>
  emit(
    AsyncResult.success({ type: "authorize", authorizationUrl: "https://forge.example/authorize" }),
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.platform = "android";
  mocks.appStateListener = null;
  mocks.signIn.mockReturnValue({});
  mocks.subscribe.mockImplementation((_atom, listener) => {
    emit = listener;
    return mocks.unsubscribe;
  });
  mocks.dismissBrowser.mockResolvedValue({ type: "dismiss" });
});

afterEach(() => vi.useRealTimers());

describe("signInToMcpServer", () => {
  it("keeps Android's browser-open receipt subscribed until the server completes sign-in", async () => {
    mocks.openBrowser.mockResolvedValue({ type: "opened" });
    const result = signInToMcpServer(input);
    authorize();
    await vi.runAllTimersAsync();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    emit(AsyncResult.success({ type: "connected" }));
    await expect(result).resolves.toEqual({ status: "connected" });
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.signIn).toHaveBeenCalledWith({
      environmentId: "remote",
      input: { server: "forgegraph", projectId: "project", callbackOrigin: "https://t3.example" },
    });
  });

  it("allows a dismissed iOS sign-in to be retried", async () => {
    mocks.platform = "ios";
    mocks.openBrowser.mockResolvedValueOnce({ type: "cancel" });
    const cancelled = signInToMcpServer(input);
    authorize();
    await vi.runAllTimersAsync();
    await expect(cancelled).resolves.toEqual({ status: "cancelled" });

    mocks.openBrowser.mockResolvedValueOnce({ type: "opened" });
    const retry = signInToMcpServer(input);
    authorize();
    emit(AsyncResult.success({ type: "connected" }));
    await expect(retry).resolves.toEqual({ status: "connected" });
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("cancels when Android returns from a closed browser without completing sign-in", async () => {
    mocks.openBrowser.mockResolvedValue({ type: "opened" });
    const result = signInToMcpServer(input);
    authorize();
    mocks.appStateListener?.("background");
    mocks.appStateListener?.("active");
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ status: "cancelled" });
    expect(mocks.removeAppStateListener).toHaveBeenCalledOnce();
  });

  it("lets the server's completion receipt win when it arrives just after the browser closes", async () => {
    mocks.openBrowser.mockResolvedValue({ type: "opened" });
    const result = signInToMcpServer(input);
    authorize();
    mocks.appStateListener?.("background");
    mocks.appStateListener?.("active");
    emit(AsyncResult.success({ type: "connected" }));
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ status: "connected" });
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("reports a browser launch failure instead of leaving sign-in pending", async () => {
    mocks.openBrowser.mockRejectedValue(new Error("No browser available"));
    const result = signInToMcpServer(input);
    authorize();
    await expect(result).resolves.toEqual({ status: "failed", message: "No browser available" });
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("ends an abandoned Android sign-in and ignores a late connected event", async () => {
    mocks.openBrowser.mockResolvedValue({ type: "opened" });
    const controller = new AbortController();
    const result = signInToMcpServer({ ...input, signal: controller.signal });
    authorize();
    controller.abort();
    await expect(result).resolves.toEqual({ status: "cancelled" });
    emit(AsyncResult.success({ type: "connected" }));
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("reports server failures and releases its subscription", async () => {
    const result = signInToMcpServer(input);
    emit(AsyncResult.failure(Cause.fail(new Error("The grant was rejected"))));
    await expect(result).resolves.toEqual({ status: "failed", message: "The grant was rejected" });
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
