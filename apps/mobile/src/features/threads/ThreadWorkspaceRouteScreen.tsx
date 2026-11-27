import { useNavigation } from "@react-navigation/native";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ComponentProps } from "react";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { useWorkspacePaneState } from "../layout/adaptive-workspace-context";
import { ReviewSheet } from "../review/ReviewSheet";
import { ThreadRouteScreen } from "./ThreadRouteScreen";
import { useOpenThreadReview } from "./thread-inspector-navigation";

type ThreadRef = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };

function ThreadWorkspaceReview({
  thread,
}: {
  readonly thread: ThreadRef & { readonly reviewKey?: string };
}) {
  const { panes } = useWorkspacePaneState();
  return panes.auxiliaryPaneVisible ? <ReviewSheet route={{ params: thread }} /> : null;
}

/** The chat retains its route and editor when a resize adds or removes its review column. */
export function ThreadWorkspaceRouteScreen({
  route,
}: Pick<ComponentProps<typeof ThreadRouteScreen>, "route">) {
  const { fileInspector } = useWorkspacePaneState();
  const navigation = useNavigation();
  const openReview = useOpenThreadReview();
  const { environmentId, threadId, draft, inspector } = route.params ?? {};
  const thread =
    fileInspector.supported && !draft && environmentId && threadId
      ? {
          environmentId: EnvironmentId.make(environmentId),
          threadId: ThreadId.make(threadId),
          reviewKey: inspector?.type === "review" ? inspector.reviewKey : undefined,
        }
      : null;
  useHardwareKeyboardCommand("review", () => {
    if (!thread || !navigation.isFocused()) return false;
    openReview(thread);
    return true;
  });
  return (
    <ThreadRouteScreen
      route={route}
      routeInspector={
        thread
          ? {
              kind: "review",
              render: () => (
                <ThreadWorkspaceReview
                  key={scopedThreadKey(thread.environmentId, thread.threadId)}
                  thread={thread}
                />
              ),
            }
          : undefined
      }
    />
  );
}
