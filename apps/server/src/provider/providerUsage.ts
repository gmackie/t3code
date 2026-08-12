import type { ProviderUsageSnapshot, ProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export type ProviderRateLimitWindow = {
  readonly id: string;
  readonly label: string;
  readonly usedPercent?: number;
  readonly remainingPercent?: number;
  readonly resetsAt?: string;
  readonly isBlocking?: boolean;
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resetTimestamp(value: unknown): string | undefined {
  const seconds = finiteNumber(value);
  if (seconds === undefined) return undefined;
  const date = DateTime.make(seconds * 1000);
  return date._tag === "None" ? undefined : DateTime.formatIso(date.value);
}

function normalizeWindow(id: string, value: unknown): ProviderRateLimitWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const usedPercent = finiteNumber(record.usedPercent);
  const resetsAt = resetTimestamp(record.resetsAt ?? record.resetAt);
  if (usedPercent === undefined) {
    if (!resetsAt && record.status !== "rejected") return undefined;
    return {
      id,
      label:
        id === "five_hour"
          ? "5-hour window"
          : id === "seven_day"
            ? "Weekly window"
            : `${id} window`,
      ...(resetsAt ? { resetsAt } : {}),
      ...(record.status === "rejected" ? { isBlocking: true } : {}),
    };
  }

  const boundedUsedPercent = Math.max(0, Math.min(100, usedPercent));
  const durationMinutes = finiteNumber(record.windowDurationMins);
  const label =
    durationMinutes !== undefined && durationMinutes >= 10_000
      ? "Weekly window"
      : durationMinutes !== undefined && durationMinutes >= 240
        ? "5-hour window"
        : `${id} window`;

  return {
    id,
    label,
    usedPercent: boundedUsedPercent,
    remainingPercent: 100 - boundedUsedPercent,
    ...(resetsAt ? { resetsAt } : {}),
  };
}

export function normalizeProviderRateLimits(
  value: unknown,
): ReadonlyArray<ProviderRateLimitWindow> {
  if (Array.isArray(value)) {
    return value.flatMap((window, index) => {
      if (!window || typeof window !== "object") return [];
      const record = window as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : `window-${index + 1}`;
      const label = typeof record.label === "string" ? record.label : `${id} window`;
      const usedPercent = finiteNumber(record.usedPercent);
      const remainingPercent = finiteNumber(record.remainingPercent);
      const resetsAt = typeof record.resetsAt === "string" ? record.resetsAt : undefined;
      return [
        {
          id,
          label,
          ...(usedPercent === undefined ? {} : { usedPercent }),
          ...(remainingPercent === undefined ? {} : { remainingPercent }),
          ...(resetsAt ? { resetsAt } : {}),
          ...(record.isBlocking === true ? { isBlocking: true } : {}),
        },
      ];
    });
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const source =
    record.rateLimits && typeof record.rateLimits === "object"
      ? (record.rateLimits as Record<string, unknown>)
      : record;
  if (typeof source.rate_limit_type === "string") {
    const window = normalizeWindow(source.rate_limit_type, source);
    return window ? [window] : [];
  }
  const ids = Array.isArray(source.windows)
    ? source.windows.map((window) =>
        window && typeof window === "object"
          ? String((window as Record<string, unknown>).id ?? "window")
          : "window",
      )
    : ["primary", "secondary", "five_hour", "seven_day"];
  const windows = Array.isArray(source.windows) ? source.windows : ids.map((id) => source[id]);
  return windows
    .map((window, index) => normalizeWindow(ids[index] ?? `window-${index + 1}`, window))
    .filter((window): window is ProviderRateLimitWindow => window !== undefined);
}

// These named entry points keep provider parsing at the adapter boundary while
// sharing the defensive field normalization used by legacy/raw events.
export const normalizeCodexRateLimits = normalizeProviderRateLimits;
export const normalizeClaudeRateLimits = normalizeProviderRateLimits;

const DEFAULT_FRESHNESS_MS = 5 * 60 * 1000;

export function toProviderUsageSnapshot(input: {
  readonly environmentId: string;
  readonly providerInstanceId: string;
  readonly driverKind: string;
  readonly windows: ReadonlyArray<ProviderUsageWindow>;
  readonly source: "provider-event" | "provider-query" | "unavailable";
  readonly updatedAt?: string;
}): ProviderUsageSnapshot {
  return {
    environmentId: input.environmentId as ProviderUsageSnapshot["environmentId"],
    providerInstanceId: input.providerInstanceId as ProviderUsageSnapshot["providerInstanceId"],
    driverKind: input.driverKind as ProviderUsageSnapshot["driverKind"],
    availability: input.source === "unavailable" ? "unavailable" : "available",
    windows: input.windows,
    lastUpdatedAt: input.updatedAt ?? DateTime.formatIso(DateTime.nowUnsafe()),
    source: input.source,
  };
}

export class ProviderUsageCache {
  readonly #snapshots = new Map<string, ProviderUsageSnapshot>();
  readonly #now: () => string;
  readonly #freshnessMs: number;
  readonly environmentId: string;

  constructor(
    environmentId: string,
    now: () => string = () => DateTime.formatIso(DateTime.nowUnsafe()),
    freshnessMs = DEFAULT_FRESHNESS_MS,
  ) {
    this.environmentId = environmentId;
    this.#now = now;
    this.#freshnessMs = freshnessMs;
  }

  set(snapshot: ProviderUsageSnapshot): void {
    if (snapshot.environmentId !== this.environmentId) return;
    this.#snapshots.set(snapshot.providerInstanceId, snapshot);
  }

  get(providerInstanceId: string, driverKind = "unknown"): ProviderUsageSnapshot {
    const snapshot = this.#snapshots.get(providerInstanceId);
    if (!snapshot) {
      return {
        environmentId: this.environmentId as ProviderUsageSnapshot["environmentId"],
        providerInstanceId: providerInstanceId as ProviderUsageSnapshot["providerInstanceId"],
        driverKind: driverKind as ProviderUsageSnapshot["driverKind"],
        availability: "unavailable",
        windows: [],
        source: "unavailable",
      };
    }

    const lastUpdatedAt = snapshot.lastUpdatedAt;
    if (!lastUpdatedAt) return snapshot;
    const ageMs = Date.parse(this.#now()) - Date.parse(lastUpdatedAt);
    if (ageMs > this.#freshnessMs && snapshot.availability === "available") {
      return { ...snapshot, availability: "stale" };
    }
    return snapshot;
  }
}
