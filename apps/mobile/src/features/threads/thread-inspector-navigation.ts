import { StackActions, useNavigation } from "@react-navigation/native";
import { createContext, use, useEffect, useEffectEvent, useRef } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Platform } from "react-native";

import { resolveMobileSideThreadPresentation } from "@t3tools/client-runtime/side-thread";

import { useWorkspacePaneState } from "../layout/adaptive-workspace-context";

export type ThreadInspectorMode = "route" | "git" | "files" | "preview";

export type ThreadInspectorTarget = {
  /** "linkedThread" is a thread on a linked environment, read through `linked.viaEnvironmentId`. */
  readonly type: "thread" | "linkedThread" | "device" | "localPreview" | "review" | "browser";
  readonly environmentId: string;
  readonly threadId: string;
  readonly linked?: {
    readonly viaEnvironmentId: string;
    readonly label: string;
    readonly title?: string;
  };
  readonly deviceKey?: string;
  readonly tabId?: string;
  /** Keeps a diff line selection when its full-screen review moves into the column. */
  readonly reviewKey?: string;
  /** The environment's localhost page a "localPreview" shows. */
  readonly url?: string;
  readonly currentUrl?: string;
};

export const ThreadInspectorNavigationContext = createContext<
  ((target: ThreadInspectorTarget) => void) | null
>(null);

export function useOpenThreadInspector() {
  const navigation = useNavigation();
  const { fileInspector } = useWorkspacePaneState();
  const openInInspector = use(ThreadInspectorNavigationContext);
  return (
    source: { readonly environmentId: string; readonly threadId: string },
    target: ThreadInspectorTarget,
  ) => {
    const sideThread = target.type === "thread" || target.type === "linkedThread";
    const presentation = resolveMobileSideThreadPresentation({
      inspectorAvailable: fileInspector.supported && (Platform.OS === "ios" || !sideThread),
    });
    if (presentation === "full-screen") return false;
    // Reviews use the host route's worktree and checkpoint selection. A nested chat opens its own review route.
    if (openInInspector && target.type === "review") return false;
    if (openInInspector) openInInspector(target);
    else {
      if (!isNearestThreadRoute(navigation.getState(), source)) return false;
      navigation.dispatch(
        StackActions.popTo("Thread", { ...source, inspector: target }, { merge: true }),
      );
    }
    return true;
  };
}

/** Opens a real thread review, keeping the current chat in place wherever it has a column. */
export function useOpenThreadReview() {
  const navigation = useNavigation();
  const openInspector = useOpenThreadInspector();
  return (
    thread: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId },
    replace = false,
  ) => {
    if (openInspector(thread, { type: "review", ...thread })) return;
    if (replace) navigation.dispatch(StackActions.replace("ThreadReview", thread));
    else navigation.navigate("ThreadReview", thread);
  };
}

/** A full-screen review or preview follows its thread into a newly available column. */
export function useInspectorOnExpand(target: ThreadInspectorTarget | null) {
  const navigation = useNavigation();
  const { fileInspector } = useWorkspacePaneState();
  const openInspector = useOpenThreadInspector();
  const supported = fileInspector.supported;
  const previouslySupported = useRef(supported);
  const moveIntoColumn = useEffectEvent(() => {
    if (target && navigation.isFocused()) {
      openInspector({ environmentId: target.environmentId, threadId: target.threadId }, target);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- move the focused navigation route only as the window gains a column, preserving explicit maximization
  useEffect(() => {
    const expanded = supported && !previouslySupported.current;
    previouslySupported.current = supported;
    if (expanded) moveIntoColumn();
  }, [supported]);
}

/** Closes the screens above `thread`, or opens it when the nearest thread route is another one. */
export function useReturnToThread() {
  const navigation = useNavigation();
  return (thread: { readonly environmentId: string; readonly threadId: string }) =>
    navigation.dispatch(
      isNearestThreadRoute(navigation.getState(), thread)
        ? StackActions.popTo("Thread", thread, { merge: true })
        : StackActions.replace("Thread", thread),
    );
}

// `Thread` has no `getId`, so `popTo("Thread")` lands on the nearest one whatever thread it shows.
function isNearestThreadRoute(
  state:
    | { readonly routes: ReadonlyArray<{ readonly name: string; readonly params?: object }> }
    | undefined,
  thread: { readonly environmentId: string; readonly threadId: string },
) {
  const params = state?.routes.findLast((route) => route.name === "Thread")?.params;
  return (
    params !== undefined &&
    "environmentId" in params &&
    params.environmentId === thread.environmentId &&
    "threadId" in params &&
    params.threadId === thread.threadId
  );
}
