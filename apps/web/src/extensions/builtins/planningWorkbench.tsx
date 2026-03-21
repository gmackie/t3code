import { useMemo } from "react";

import ChatMarkdown from "../../components/ChatMarkdown";
import { PlanSteps } from "../../components/PlanSteps";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ScrollArea } from "../../components/ui/scroll-area";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { readNativeApi } from "../../nativeApi";
import { proposedPlanTitle } from "../../proposedPlan";
import { toastManager } from "../../components/ui/toast";
import type { T3ExtensionDefinition } from "../types";
import {
  buildPlanningRequirementsMarkdown,
  buildPlanningTaskDrafts,
} from "./planningWorkbench.logic";

function saveArtifact(params: {
  workspaceRoot: string | null;
  relativePath: string;
  contents: string;
  title: string;
}) {
  const api = readNativeApi();
  if (!api || !params.workspaceRoot) {
    toastManager.add({
      type: "warning",
      title: "Workspace path is unavailable",
      description: "Open a thread with a project workspace to save planning artifacts.",
    });
    return;
  }

  void api.projects
    .writeFile({
      cwd: params.workspaceRoot,
      relativePath: params.relativePath,
      contents: params.contents,
    })
    .then((result) => {
      toastManager.add({
        type: "success",
        title: params.title,
        description: result.relativePath,
      });
    })
    .catch((error) => {
      toastManager.add({
        type: "error",
        title: "Could not save artifact",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
}

export const planningWorkbenchExtension: T3ExtensionDefinition = {
  id: "planning-workbench",
  title: "Planning",
  surface: "thread.sidePanel",
  order: 5,
  isAvailable: (context) => context.threadView !== null,
  render: (context) => <PlanningWorkbenchPanel context={context} />,
};

function PlanningWorkbenchPanel({
  context,
}: {
  context: Parameters<T3ExtensionDefinition["render"]>[0];
}) {
  const threadView = context.threadView;
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const planMarkdown = threadView?.latestProposedPlan?.planMarkdown ?? "";
  const requirementsMarkdown = useMemo(
    () => buildPlanningRequirementsMarkdown(planMarkdown),
    [planMarkdown],
  );
  const taskDrafts = useMemo(() => buildPlanningTaskDrafts(planMarkdown), [planMarkdown]);

  if (!threadView) return null;

  const workspaceRoot = threadView.project?.cwd ?? null;
  const planTitle = planMarkdown ? proposedPlanTitle(planMarkdown) : null;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-4 p-3">
        {/* Header */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {planTitle ?? threadView.thread.title}
              </p>
              <p className="text-xs text-muted-foreground">Planning workbench</p>
            </div>
            <Badge variant="secondary">Draft</Badge>
          </div>
        </section>

        {/* Active Plan Steps */}
        {threadView.activePlan ? <PlanSteps steps={threadView.activePlan.steps} /> : null}

        {planMarkdown ? (
          <>
            {/* Proposed Plan */}
            <section className="space-y-2">
              <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                Proposed Plan
              </p>
              <div className="rounded-lg border border-border/60 bg-background/50 p-3">
                <ChatMarkdown
                  text={planMarkdown}
                  cwd={workspaceRoot ?? undefined}
                  isStreaming={false}
                />
              </div>
            </section>

            {/* Requirements */}
            <section className="space-y-2">
              <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                Requirements
              </p>
              {taskDrafts.length > 0 ? (
                <>
                  <div className="rounded-lg border border-border/60 bg-background/50 p-3">
                    <ChatMarkdown
                      text={requirementsMarkdown}
                      cwd={workspaceRoot ?? undefined}
                      isStreaming={false}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => copyToClipboard(requirementsMarkdown, undefined)}
                    >
                      {isCopied ? "Copied requirements" : "Copy requirements"}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() =>
                        saveArtifact({
                          workspaceRoot,
                          relativePath: `requirements-${Date.now()}.md`,
                          contents: requirementsMarkdown,
                          title: "Requirements saved",
                        })
                      }
                    >
                      Save requirements
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground/50">
                  No structured requirements detected. Use checkboxes or numbered lists in your plan.
                </p>
              )}
            </section>

            {/* Task Drafts */}
            <section className="space-y-2">
              <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                Task Drafts
              </p>
              {taskDrafts.length > 0 ? (
                <>
                  <div className="space-y-2">
                    {taskDrafts.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-lg border border-border/60 bg-background/50 px-3 py-2"
                      >
                        <p className="text-sm text-foreground">{task.title}</p>
                      </div>
                    ))}
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() =>
                      saveArtifact({
                        workspaceRoot,
                        relativePath: `task-drafts-${Date.now()}.json`,
                        contents: `${JSON.stringify(taskDrafts, null, 2)}\n`,
                        title: "Task drafts saved",
                      })
                    }
                  >
                    Save tasks
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground/50">
                  No task items found in the plan. List items are converted to task drafts.
                </p>
              )}
            </section>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 bg-background/30 p-4 text-sm text-muted-foreground">
            No proposed plan yet. Use plan mode in the active thread, then reopen this panel.
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
