import type { ProviderUsageSnapshot } from "@t3tools/contracts";
import { RefreshCwIcon } from "lucide-react";

import { formatContextWindowTokens, type ContextWindowSnapshot } from "~/lib/contextWindow";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

export function ProviderUsagePopover(props: {
  snapshot: ProviderUsageSnapshot;
  contextWindow: ContextWindowSnapshot | null;
  providerDisplayName: string;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}) {
  const { snapshot, contextWindow } = props;
  return (
    <div className="flex min-w-64 flex-col gap-3 p-[var(--floating-content-inset)] text-left">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-muted-foreground text-xs">
            {props.providerDisplayName}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/70">Provider quota</div>
        </div>
        {props.onRefresh ? (
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={props.onRefresh}
            disabled={props.isRefreshing}
            aria-label="Refresh provider usage"
          >
            <RefreshCwIcon className={cn("size-3.5", props.isRefreshing && "animate-spin")} />
          </Button>
        ) : null}
      </div>

      {snapshot.windows.length > 0 ? (
        <div className="grid gap-2">
          {snapshot.windows.map((window) => (
            <div key={window.id} className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className="text-muted-foreground/75">{window.label}</span>
                <span className="font-medium tabular-nums">
                  {window.remainingPercent !== undefined
                    ? `${Math.round(window.remainingPercent)}% left`
                    : window.isBlocking
                      ? "Blocked"
                      : "Usage available"}
                </span>
              </div>
              {window.remainingPercent !== undefined ? (
                <div className="h-1.5 overflow-hidden rounded-full bg-muted/60">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      window.remainingPercent <= 10
                        ? "bg-red-500"
                        : window.remainingPercent <= 25
                          ? "bg-amber-500"
                          : "bg-foreground/60",
                    )}
                    style={{ width: `${Math.max(0, Math.min(100, window.remainingPercent))}%` }}
                  />
                </div>
              ) : null}
              {window.resetsAt ? (
                <span className="text-[10px] text-muted-foreground/60">
                  Resets {new Date(window.resetsAt).toLocaleString()}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground/70">
          {snapshot.availability === "unavailable"
            ? "This provider does not expose quota data."
            : (snapshot.errorMessage ?? "No quota windows reported.")}
        </div>
      )}

      {contextWindow ? (
        <div className="border-border/70 border-t pt-2">
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-muted-foreground/75">Context window</span>
            <span className="font-medium tabular-nums">
              {formatContextWindowTokens(contextWindow.usedTokens)}/
              {formatContextWindowTokens(contextWindow.maxTokens ?? null)}
            </span>
          </div>
          {contextWindow.totalProcessedTokens !== undefined &&
          contextWindow.totalProcessedTokens !== null ? (
            <div className="mt-1 flex items-center justify-between gap-3 text-[10px] text-muted-foreground/60">
              <span>Total processed</span>
              <span className="tabular-nums">
                {formatContextWindowTokens(contextWindow.totalProcessedTokens ?? null)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="text-[10px] text-muted-foreground/55">
        {snapshot.lastUpdatedAt
          ? `Updated ${new Date(snapshot.lastUpdatedAt).toLocaleString()}`
          : "Not updated yet"}
      </div>
    </div>
  );
}
