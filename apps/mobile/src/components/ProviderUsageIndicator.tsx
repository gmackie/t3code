import type { EnvironmentId, ProviderInstanceId, ProviderUsageSnapshot } from "@t3tools/contracts";
import {
  isProviderUsageBlocking,
  providerUsageRemainingPercent,
} from "@t3tools/client-runtime/state/provider-usage";
import { RegistryContext } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { useContext } from "react";
import { useMemo } from "react";
import { ControlPill, ControlPillMenu } from "./ControlPill";
import { providerUsageEnvironment } from "../state/providerUsage";
import { useEnvironmentQuery } from "../state/query";

function usageLabel(snapshot: ProviderUsageSnapshot | null): string {
  if (!snapshot || snapshot.availability === "unavailable") return "Quota unavailable";
  if (snapshot.availability === "error") return "Quota error";
  const blocking = snapshot.windows.find((window) => window.isBlocking);
  if (isProviderUsageBlocking(snapshot) && blocking) {
    return blocking.resetsAt ? `Blocked until ${formatReset(blocking.resetsAt)}` : "Quota blocked";
  }
  const remaining = providerUsageRemainingPercent(snapshot);
  return remaining === null ? "Quota available" : `${Math.round(remaining)}% quota left`;
}

function formatReset(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function compactUsageLabel(snapshot: ProviderUsageSnapshot | null): string {
  if (!snapshot || snapshot.availability === "unavailable" || snapshot.availability === "error") {
    return "Quota";
  }
  if (isProviderUsageBlocking(snapshot)) return "Blocked";
  const remaining = providerUsageRemainingPercent(snapshot);
  return remaining === null ? "Quota" : `${Math.round(remaining)}%`;
}

export function ProviderUsageIndicator(props: {
  readonly environmentId: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly compact?: boolean;
}) {
  const input = { providerInstanceId: props.providerInstanceId };
  const cached = useEnvironmentQuery(
    providerUsageEnvironment.get({ environmentId: props.environmentId, input }),
  );
  const events = useEnvironmentQuery(
    providerUsageEnvironment.events({ environmentId: props.environmentId, input }),
  );
  const registry = useContext(RegistryContext);
  const snapshot = events.data ?? cached.data;
  const actions = useMemo(
    () => [
      {
        id: "usage-summary",
        title: usageLabel(snapshot),
        subtitle: snapshot?.windows.map((window) => window.label).join(" · ") || undefined,
        attributes: { destructive: false },
      },
      { id: "usage-refresh", title: "Refresh usage" },
    ],
    [snapshot],
  );

  return (
    <ControlPillMenu
      actions={actions}
      title="Provider usage"
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "usage-refresh") {
          void runAtomCommand(
            registry,
            providerUsageEnvironment.refresh,
            { environmentId: props.environmentId, input },
            { reportFailure: false },
          );
        }
      }}
    >
      <ControlPill
        icon="bolt.circle"
        label={
          cached.isPending || events.isPending
            ? props.compact
              ? "…"
              : "Usage…"
            : props.compact
              ? compactUsageLabel(snapshot)
              : usageLabel(snapshot)
        }
        accessibilityLabel="Provider usage"
      />
    </ControlPillMenu>
  );
}
