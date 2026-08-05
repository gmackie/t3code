import type { ProviderUsageSnapshot } from "@t3tools/contracts";
import {
  isProviderUsageBlocking,
  providerUsageRemainingPercent,
} from "@t3tools/client-runtime/state/provider-usage";
import { CircleAlertIcon, CircleCheckIcon, CircleSlash2Icon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ProviderUsagePopover } from "./ProviderUsagePopover";
import type { ContextWindowSnapshot } from "~/lib/contextWindow";

export function statusLabel(snapshot: ProviderUsageSnapshot): string {
  if (snapshot.availability === "unavailable") return "Quota unavailable";
  if (snapshot.availability === "error") return "Quota unavailable";
  if (snapshot.availability === "stale") return "Quota stale";
  if (isProviderUsageBlocking(snapshot)) return "Provider limit reached";
  const remaining = providerUsageRemainingPercent(snapshot);
  return remaining === null ? "Provider quota" : `${Math.round(remaining)}% quota left`;
}

export function providerUsageDisplayLabel(
  snapshot: ProviderUsageSnapshot | null,
  isRefreshing: boolean,
): string {
  if (!snapshot) return isRefreshing ? "Loading quota…" : "Quota unavailable";
  return statusLabel(snapshot);
}

export function ProviderUsageStatus(props: {
  snapshot: ProviderUsageSnapshot | null;
  contextWindow: ContextWindowSnapshot | null;
  providerDisplayName: string;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}) {
  const isBlocked = isProviderUsageBlocking(props.snapshot);
  const isUnavailable =
    !props.snapshot ||
    props.snapshot.availability === "unavailable" ||
    props.snapshot.availability === "error";
  const remainingPercent = providerUsageRemainingPercent(props.snapshot);
  const isLow = remainingPercent !== null && remainingPercent <= 25;
  const Icon =
    isBlocked || isLow ? CircleAlertIcon : isUnavailable ? CircleSlash2Icon : CircleCheckIcon;
  const label = providerUsageDisplayLabel(props.snapshot, props.isRefreshing ?? false);

  const statusButton = (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border border-transparent px-2 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        isBlocked && "text-red-500",
        !isBlocked && isLow && "text-amber-500",
        !isBlocked && isUnavailable && "text-muted-foreground/70",
        !isBlocked && !isUnavailable && "text-muted-foreground",
      )}
      aria-label={`${props.providerDisplayName}: ${label}`}
    >
      <Icon className="size-3.5" />
      <span className="max-w-28 truncate">{label}</span>
    </button>
  );

  if (!props.snapshot) return statusButton;

  return (
    <Popover>
      <PopoverTrigger openOnHover delay={150} closeDelay={0} render={statusButton} />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        viewportClassName="p-0"
        className="max-w-none"
      >
        <ProviderUsagePopover {...props} snapshot={props.snapshot} />
      </PopoverPopup>
    </Popover>
  );
}
