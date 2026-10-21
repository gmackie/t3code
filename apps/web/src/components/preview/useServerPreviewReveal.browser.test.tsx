import { EnvironmentId, ThreadId, type PreviewSessionSnapshot } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { expect, it } from "vite-plus/test";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import {
  applyPreviewServerEvent,
  reconcilePreviewServerSessions,
  resetPreviewStateForTests,
  useThreadPreviewState,
} from "~/previewStateStore";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useServerPreviewReveal } from "./useServerPreviewReveal";
import { act, render } from "../../../test/render";
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
function Probe() {
  const state = useThreadPreviewState(ref);
  useServerPreviewReveal(ref, true, state, false, []);
  return null;
}
const mount = () =>
  render(
    <AppAtomRegistryProvider>
      <Probe />
    </AppAtomRegistryProvider>,
    { router: false },
  );
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
// Stores are module state, so each test starts from empty ones.
const reset = () => {
  resetPreviewStateForTests();
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
};
it("reveals a live active-thread request overtaking initial list hydration", async () => {
  reset();
  await using _screen = await mount();
  await event();
  expect(player()).toBeUndefined();
  await list();
  expect(player()?.source).toEqual({ kind: "browser", tabId: "server-tab" });
});
it("does not reopen a dismissed player on remount or refreshed historical metadata", async () => {
  reset();
  await using first = await mount();
  await event();
  await list();
  await act(() => usePreviewMiniPlayerStore.getState().close(ref));
  await first.unmount();
  await using _second = await mount();
  await list();
  expect(player()).toBeUndefined();
  await event(2, { ...snapshot, revealRequest: { id: "new-request", force: true } });
  expect(player()?.source).toEqual({ kind: "browser", tabId: "server-tab" });
});
it("does not treat a restored server tab as a live request", async () => {
  reset();
  await list();
  await using _screen = await mount();
  expect(player()).toBeUndefined();
});
