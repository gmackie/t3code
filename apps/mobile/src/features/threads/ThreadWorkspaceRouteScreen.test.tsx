import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { deriveLayout, deriveWorkspacePaneLayout } from "../../lib/layout";
import { appAtomRegistry } from "../../state/atom-registry";
import { WorkspacePaneStateContext } from "../layout/adaptive-workspace-context";
import { useReviewCacheForThread } from "../review/reviewState";
import { useReviewSections } from "../review/useReviewSections";
import { ThreadWorkspaceRouteScreen } from "./ThreadWorkspaceRouteScreen";

const queries = vi.hoisted(() => ({ diff: vi.fn() }));
vi.mock("../../state/queries", () => ({ useCheckpointDiff: queries.diff }));
vi.mock("../../state/use-thread-selection", () => ({
  useThreadSelection: () => ({ selectedThreadProject: null }),
}));
vi.mock("../../state/use-selected-thread-worktree", () => ({
  useSelectedThreadWorktree: () => ({ selectedThreadCwd: null }),
}));
vi.mock("../../state/review", () => ({
  reviewEnvironment: {},
  lastReviewGitSectionsAtom: vi.fn(),
}));
vi.mock("../../state/session", () => ({ environmentSession: { sessionStateAtom: () => null } }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: false }),
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({ isReady: true }),
}));
vi.mock("../../state/use-thread-detail", () => ({
  useSelectedThreadProjection: () => ({
    projection: {
      messages: [],
      checkpoints: [1, 2].map((n) => ({
        appRunOrdinal: n,
        id: `checkpoint-${n}`,
        ref: `ref-${n}`,
        runId: `run-${n}`,
        status: "ready",
        files: [],
        capturedAt: DateTime.makeUnsafe(0),
      })),
    },
  }),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, View: "div" }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ isFocused: () => true }) }));
vi.mock("../../components/ui/ScreenContent", () => ({
  ScreenContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./ThreadDetailScreen", () => ({ ThreadDetailScreen: () => null }));

// Keep the real route and screen outlet. The native editor and diff view have DOM stand-ins.
vi.mock("./ThreadRouteScreen", async () => {
  const { ThreadScreenHost, ThreadScreenFallback } = await import("./ThreadScreenHost");
  return {
    ThreadRouteScreen: ({ routeInspector }: { routeInspector?: { render: () => ReactNode } }) => (
      <ThreadScreenHost>
        <ThreadScreenFallback>
          <textarea aria-label="Draft" />
        </ThreadScreenFallback>
        {routeInspector?.render()}
      </ThreadScreenHost>
    ),
  };
});
vi.mock("../review/ReviewSheet", () => ({
  ReviewSheet: ({
    route,
  }: {
    route: { params: { environmentId: EnvironmentId; threadId: ThreadId } };
  }) => {
    const reviewCache = useReviewCacheForThread(route.params);
    const { selectedSection, selectSection } = useReviewSections({ ...route.params, reviewCache });
    return (
      <aside>
        <button onClick={() => selectSection("turn:1")}>First turn</button>
        <pre>{selectedSection?.diff}</pre>
      </aside>
    );
  },
}));

it("keeps the editor and selected checkpoint across a fold and text reflow using the active route's environment", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  queries.diff.mockImplementation(({ environmentId, threadId, toTurnCount }) => ({
    data: { diff: `+${environmentId}/${threadId} turn ${toTurnCount}` },
    isPending: false,
    error: null,
  }));
  const container = document.createElement("div");
  const root = createRoot(container);
  using _root = { [Symbol.dispose]: () => act(() => root.unmount()) };
  type Params = ComponentProps<typeof ThreadWorkspaceRouteScreen>["route"]["params"];
  const thread = { environmentId: "remote-A", threadId: "shared-id" };
  const render = (width: number, fontScale: number, params: Params = thread, visible = true) => {
    const layout = deriveLayout({ width, height: 951, fontScale });
    const panes = deriveWorkspacePaneLayout({
      layout,
      viewportWidth: width,
      minimumMainWidth: 320,
      primarySidebarPreferredVisible: false,
      auxiliaryPanePreferredVisible: visible,
    });
    act(() =>
      root.render(
        <RegistryContext value={appAtomRegistry}>
          <WorkspacePaneStateContext
            value={{
              panes,
              fileInspector: {
                supported: panes.supportsAuxiliaryPane,
                width: panes.auxiliaryPaneWidth,
              },
              sidebarToggleable: false,
              sidebarByOrientation: null,
              primarySidebarSearchQuery: "",
            }}
          >
            <ThreadWorkspaceRouteScreen route={{ params }} />
          </WorkspacePaneStateContext>
        </RegistryContext>,
      ),
    );
  };
  render(390, 1);
  const editor = container.querySelector("textarea")!;
  editor.value = "finish this thought";
  editor.setSelectionRange(7, 11);
  expect(queries.diff).not.toHaveBeenCalled();
  render(669, 1);
  expect(container.querySelector("pre")?.textContent).toBe("+remote-A/shared-id turn 2");
  act(() => container.querySelector("button")!.click());
  expect(container.querySelector("pre")?.textContent).toBe("+remote-A/shared-id turn 1");
  for (const [width, scale] of [
    [390, 1],
    [951, 1.5],
  ] as const) {
    render(width, scale);
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("textarea")).toBe(editor);
    expect([editor.value, editor.selectionStart, editor.selectionEnd]).toEqual([
      "finish this thought",
      7,
      11,
    ]);
    render(669, 1);
    expect(container.querySelector("pre")?.textContent).toBe("+remote-A/shared-id turn 1");
  }
  render(669, 1, { ...thread, environmentId: "remote-B" });
  expect(container.querySelector("pre")?.textContent).toBe("+remote-B/shared-id turn 2");
  for (const params of [
    { ...thread, draft: { requestId: "draft-1" } },
    { threadId: thread.threadId },
  ]) {
    render(669, 1, params);
    expect(container.querySelector("aside")).toBeNull();
  }
  queries.diff.mockClear();
  render(669, 1, thread, false);
  expect(queries.diff).not.toHaveBeenCalled();
});
