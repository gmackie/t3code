import { WS_METHODS } from "@t3tools/contracts";
import type { ProviderUsageSnapshot } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";

import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function isProviderUsageBlocking(snapshot: ProviderUsageSnapshot | null): boolean {
  return snapshot?.windows.some((window) => window.isBlocking === true) ?? false;
}

export function providerUsageRemainingPercent(
  snapshot: ProviderUsageSnapshot | null,
): number | null {
  if (!snapshot || snapshot.availability === "unavailable" || snapshot.availability === "error") {
    return null;
  }
  const remaining = snapshot.windows
    .map((window) => window.remainingPercent)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  return remaining.length > 0 ? Math.min(...remaining) : null;
}

export function isProviderUsageStale(snapshot: ProviderUsageSnapshot | null): boolean {
  return snapshot?.availability === "stale";
}

export function createProviderUsageEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    get: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:provider-usage:get",
      tag: WS_METHODS.providerUsageGet,
      staleTimeMs: 30_000,
      idleTtlMs: 60_000,
    }),
    refresh: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:provider-usage:refresh",
      tag: WS_METHODS.providerUsageRefresh,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) => `${environmentId}:${input.providerInstanceId}`,
      },
    }),
    events: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:provider-usage:events",
      tag: WS_METHODS.providerUsageSubscribe,
    }),
  };
}
