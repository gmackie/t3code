import * as Schema from "effect/Schema";

import { EnvironmentId, NonNegativeInt } from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const ProviderUsageAvailability = Schema.Literals([
  "available",
  "unavailable",
  "stale",
  "error",
]);
export type ProviderUsageAvailability = typeof ProviderUsageAvailability.Type;

export const ProviderUsageWindow = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  usedPercent: Schema.optional(Schema.Number),
  remainingPercent: Schema.optional(Schema.Number),
  usedUnits: Schema.optional(NonNegativeInt),
  remainingUnits: Schema.optional(NonNegativeInt),
  resetsAt: Schema.optional(Schema.String),
  isBlocking: Schema.optional(Schema.Boolean),
});
export type ProviderUsageWindow = typeof ProviderUsageWindow.Type;

export const ProviderUsageSnapshot = Schema.Struct({
  environmentId: EnvironmentId,
  providerInstanceId: ProviderInstanceId,
  driverKind: ProviderDriverKind,
  availability: ProviderUsageAvailability,
  windows: Schema.Array(ProviderUsageWindow),
  lastUpdatedAt: Schema.optional(Schema.String),
  errorMessage: Schema.optional(Schema.String),
  source: Schema.Literals(["provider-event", "provider-query", "unavailable"]),
});
export type ProviderUsageSnapshot = typeof ProviderUsageSnapshot.Type;

export const ProviderUsageGetInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
});
export type ProviderUsageGetInput = typeof ProviderUsageGetInput.Type;

export const ProviderUsageSubscribeInput = ProviderUsageGetInput;
export type ProviderUsageSubscribeInput = typeof ProviderUsageSubscribeInput.Type;

export const ProviderUsageRefreshResult = Schema.Struct({
  snapshot: ProviderUsageSnapshot,
  refreshQueued: Schema.Boolean,
});
export type ProviderUsageRefreshResult = typeof ProviderUsageRefreshResult.Type;
