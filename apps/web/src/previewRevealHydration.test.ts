import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type PreviewSessionSnapshot } from "@t3tools/contracts";
import { beforeEach, expect, it } from "vite-plus/test";

import {
  applyPreviewServerEvent,
  applyPreviewServerSnapshot,
  beginPreviewSessionClose,
  consumePreviewRevealRequest,
  readThreadPreviewState,
  reconcilePreviewServerSessions,
  resetPreviewStateForTests,
} from "./previewStateStore";

const ref = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread"));
const snapshot: PreviewSessionSnapshot = {
  threadId: "thread",
  tabId: "tab",
  runtime: "server",
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-07T12:00:00.000Z",
  reveal: true,
  revealRequest: { id: "request", force: true },
};
const list = (serverEpoch = "server", revision = 1) =>
  reconcilePreviewServerSessions(ref, { serverEpoch, revision, sessions: [snapshot] });
const reveal = (revision = 1, session = snapshot) =>
  applyPreviewServerEvent(ref, {
    type: "navigated",
    threadId: "thread",
    tabId: "tab",
    createdAt: session.updatedAt,
    snapshot: session,
    serverEpoch: "server",
    revision,
  });

beforeEach(resetPreviewStateForTests);

it("retains a live forced reveal received before the first authoritative list", () => {
  reveal();
  expect(readThreadPreviewState(ref).listLoaded).toBe(false);
  list();
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({ tab: "request" });
});

it("does not interpret restored force metadata as a new reveal", () => {
  list();
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({});
  reveal(2);
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({});
});

it("consumes live requests once, retaining dismissal across navigation and list refresh", () => {
  reveal();
  list();
  expect(consumePreviewRevealRequest(ref, "tab", "request")).toBe(true);
  expect(consumePreviewRevealRequest(ref, "tab", "request")).toBe(false);
  reveal(2);
  list("server", 2);
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({});
});

it("keeps a newer request when an earlier consumer acknowledges its predecessor", () => {
  reveal();
  reveal(2, { ...snapshot, revealRequest: { id: "new", force: true } });
  consumePreviewRevealRequest(ref, "tab", "request");
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({ tab: "new" });
});

it("ignores stale lists without discarding a pending live request", () => {
  reveal(2);
  list("server", 1);
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({ tab: "request" });
  list("server", 2);
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({ tab: "request" });
});

it("discards pending requests from the previous server epoch", () => {
  reveal();
  list("replacement-server");
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({});
});

it("drops a live request when its tab closes before list hydration", () => {
  reveal();
  applyPreviewServerEvent(ref, {
    type: "closed",
    threadId: "thread",
    tabId: "tab",
    createdAt: snapshot.updatedAt,
    serverEpoch: "server",
    revision: 2,
  });
  reconcilePreviewServerSessions(ref, { serverEpoch: "server", revision: 2, sessions: [] });
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({});
  expect(readThreadPreviewState(ref).sessions).toEqual({});
});

it("does not reveal a locally suppressed tab from a later event or list", () => {
  reveal();
  beginPreviewSessionClose(ref, "tab");
  reveal(2, { ...snapshot, revealRequest: { id: "later", force: true } });
  list("server", 2);
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({});
  expect(readThreadPreviewState(ref).sessions).toEqual({});
});

it("accepts a later explicit reveal after the previous request was consumed", () => {
  reveal();
  list();
  expect(consumePreviewRevealRequest(ref, "tab", "request")).toBe(true);
  reveal(2, { ...snapshot, revealRequest: { id: "later", force: true } });
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({ tab: "later" });
  expect(consumePreviewRevealRequest(ref, "tab", "later")).toBe(true);
  expect(consumePreviewRevealRequest(ref, "tab", "later")).toBe(false);
});

it("clears pending reveals when the preview snapshot resets", () => {
  reveal();
  applyPreviewServerSnapshot(ref, null);
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({});
  expect(readThreadPreviewState(ref).sessions).toEqual({});
  list();
  expect(readThreadPreviewState(ref).pendingRevealRequests).toEqual({});
});
