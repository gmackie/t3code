import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ArrowDownRightIcon, WaypointsIcon } from "lucide-react";

import { useRoutingThreadHistory } from "../../state/routing";
import { Badge } from "../ui/badge";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { composerFloatingLayerProps } from "./composerEventScope";
import {
  formatRoutingAdvice,
  formatRoutingBadgeLabel,
  formatRoutingDecision,
  formatRoutingSource,
  latestRoutingDecision,
} from "./RoutingBadge.logic";

/**
 * The router's latest decision for this thread, shown beside the context
 * meter. Renders nothing until the router has decided something, so a thread
 * on a model that is not routed never gains an empty control.
 */
export function RoutingBadge({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const decision = latestRoutingDecision(useRoutingThreadHistory(environmentId, threadId));
  if (decision === null) return null;
  const advice = formatRoutingAdvice(decision.advice);
  const summary = formatRoutingDecision(decision);

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <Badge
            variant={decision.downgraded ? "warning" : "outline"}
            size="control"
            render={<button type="button" aria-label={summary} />}
          >
            {decision.downgraded ? (
              <ArrowDownRightIcon aria-hidden="true" />
            ) : (
              <WaypointsIcon aria-hidden="true" />
            )}
            {formatRoutingBadgeLabel(decision)}
          </Badge>
        }
      />
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        align="end"
        padding="none"
        width="sm"
        className="text-left whitespace-normal"
      >
        <div className="flex flex-col gap-2 p-(--floating-content-inset)">
          <div className="font-medium text-muted-foreground text-xs">Routing</div>
          <div className="text-xs text-foreground">{summary}</div>
          <div className="flex items-center justify-between gap-3 text-2xs leading-4">
            <span className="text-secondary-label">Classified by</span>
            <span className="font-medium text-secondary-label">
              {formatRoutingSource(decision)}
            </span>
          </div>
          {decision.downgraded ? (
            <div className="text-pretty text-warning-foreground text-2xs font-medium">
              Downgraded below the strongest tier.
            </div>
          ) : null}
          {advice ? (
            <div className="text-pretty text-secondary-label text-2xs font-medium">{advice}</div>
          ) : null}
          {decision.reasons.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-2xs text-secondary-label">
              {decision.reasons.slice(0, 4).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
