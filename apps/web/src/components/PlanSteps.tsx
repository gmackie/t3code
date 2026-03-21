import { CheckIcon, LoaderIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import type { ActivePlanState } from "../session-logic";

function stepStatusIcon(status: string): React.ReactNode {
  if (status === "completed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
        <CheckIcon className="size-3" />
      </span>
    );
  }
  if (status === "inProgress") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
        <LoaderIcon className="size-3 animate-spin" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/30">
      <span className="size-1.5 rounded-full bg-muted-foreground/30" />
    </span>
  );
}

interface PlanStepsProps {
  steps: ActivePlanState["steps"];
}

export function PlanSteps({ steps }: PlanStepsProps) {
  if (steps.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="mb-2 text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
        Steps
      </p>
      {steps.map((step, index) => (
        <div
          key={index}
          className={cn(
            "flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-200",
            step.status === "inProgress" && "bg-blue-500/5",
            step.status === "completed" && "bg-emerald-500/5",
          )}
        >
          <div className="mt-0.5">{stepStatusIcon(step.status)}</div>
          <p
            className={cn(
              "text-[13px] leading-snug",
              step.status === "completed"
                ? "text-muted-foreground/50 line-through decoration-muted-foreground/20"
                : step.status === "inProgress"
                  ? "text-foreground/90"
                  : "text-muted-foreground/70",
            )}
          >
            {step.step}
          </p>
        </div>
      ))}
    </div>
  );
}
