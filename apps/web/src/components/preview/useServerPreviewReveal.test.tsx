import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { EnvironmentId, ThreadId, type PreviewSessionSnapshot } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import {
  applyPreviewServerEvent,
  reconcilePreviewServerSessions,
  resetPreviewStateForTests,
  useThreadPreviewState,
} from "~/previewStateStore";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useServerPreviewReveal } from "./useServerPreviewReveal";
const ref = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("active-thread"));
const snapshot: PreviewSessionSnapshot = {
  threadId: ref.threadId,
  tabId: "server-tab",
  runtime: "server",
  navStatus: { _tag: "Success", url: "https://preflight.forgegraf.com", title: "Preflight" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-10T12:00:00.000Z",
  reveal: true,
  revealRequest: { id: "forced-request", force: true },
};
let renderer: ReactTestRenderer | null = null;
function Probe() {
  const state = useThreadPreviewState(ref);
  useServerPreviewReveal(ref, true, state, false, []);
  return null;
}
const mount = () =>
  act(() => {
    renderer = create(
      <AppAtomRegistryProvider>
        <Probe />
      </AppAtomRegistryProvider>,
    );
  });
const event = (revision = 1, session = snapshot) =>
  act(() => {
    applyPreviewServerEvent(ref, {
      type: "opened",
      threadId: ref.threadId,
      tabId: session.tabId,
      serverEpoch: "server",
      revision,
      snapshot: session,
      createdAt: session.updatedAt,
    });
  });
const list = () =>
  act(() => {
    reconcilePreviewServerSessions(ref, {
      serverEpoch: "server",
      revision: 1,
      sessions: [snapshot],
    });
  });
const player = () => usePreviewMiniPlayerStore.getState().byThreadKey[scopedThreadKey(ref)];
beforeEach(() => {
  resetPreviewStateForTests();
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});
it("reveals a live active-thread request overtaking initial list hydration", async () => {
  await mount();
  await event();
  expect(player()).toBeUndefined();
  await list();
  expect(player()?.source).toEqual({ kind: "browser", tabId: "server-tab" });
});
it("does not reopen a dismissed player on remount or refreshed historical metadata", async () => {
  await mount();
  await event();
  await list();
  await act(() => usePreviewMiniPlayerStore.getState().close(ref));
  await act(() => renderer?.unmount());
  await mount();
  await list();
  expect(player()).toBeUndefined();
  await event(2, { ...snapshot, revealRequest: { id: "new-request", force: true } });
  expect(player()?.source).toEqual({ kind: "browser", tabId: "server-tab" });
});
it("does not treat a restored server tab as a live request", async () => {
  await list();
  await mount();
  expect(player()).toBeUndefined();
});
