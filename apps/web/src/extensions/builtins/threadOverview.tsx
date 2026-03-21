import { Badge } from "../../components/ui/badge";
import { ScrollArea } from "../../components/ui/scroll-area";
import type { T3ExtensionDefinition } from "../types";

export const threadOverviewExtension: T3ExtensionDefinition = {
  id: "thread-overview",
  title: "Thread Overview",
  surface: "thread.sidePanel",
  order: 0,
  isAvailable: (context) => context.threadView !== null,
  render: (context) => {
    const threadView = context.threadView;
    if (!threadView) return null;

    return (
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          <section className="space-y-2">
            <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
              Thread
            </p>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{threadView.thread.title}</p>
              <p className="text-xs text-muted-foreground">
                {threadView.project?.cwd ?? "No project"}
              </p>
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
              Signals
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Approvals {threadView.pendingApprovals.length}</Badge>
              <Badge variant="secondary">Questions {threadView.pendingUserInputs.length}</Badge>
              <Badge variant="secondary">Work log {threadView.workLog.length}</Badge>
            </div>
          </section>

          {threadView.latestProposedPlan ? (
            <section className="space-y-2">
              <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
                Latest Plan
              </p>
              <pre className="overflow-x-auto rounded-lg border border-border/60 bg-background/50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {threadView.latestProposedPlan.planMarkdown}
              </pre>
            </section>
          ) : null}
        </div>
      </ScrollArea>
    );
  },
};
