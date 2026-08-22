import type { ProviderUsageSnapshot, ProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

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
  return Option.match(DateTime.make(seconds * 1000), {
    onNone: () => undefined,
    onSome: DateTime.formatIso,
  });
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
export function normalizeClaudeRateLimits(value: unknown): ReadonlyArray<ProviderRateLimitWindow> {
  const native = normalizeProviderRateLimits(value);
  if (native.length > 0 || !value || typeof value !== "object") return native;
  const record = value as Record<string, unknown>;
  const nativeInfo = record.rate_limit_info;
  if (nativeInfo && typeof nativeInfo === "object") {
    const info = nativeInfo as Record<string, unknown>;
    const id = typeof info.rateLimitType === "string" ? info.rateLimitType : "rate_limit";
    const utilization = finiteNumber(info.utilization);
    const usedPercent = utilization === undefined ? undefined : boundedPercent(utilization * 100);
    const resetsAt = resetTimestamp(info.resetsAt);
    const isBlocking = info.status === "rejected";
    if (usedPercent !== undefined || resetsAt !== undefined || isBlocking) {
      return [
        {
          id,
          label: id.includes("seven_day") ? "Weekly window" : `${id.replaceAll("_", " ")} window`,
          ...(usedPercent === undefined
            ? {}
            : { usedPercent, remainingPercent: 100 - usedPercent }),
          ...(resetsAt ? { resetsAt } : {}),
          ...(isBlocking ? { isBlocking: true } : {}),
        },
      ];
    }
  }
  return ["five_hour", "seven_day", "seven_day_sonnet", "seven_day_opus"].flatMap((id) => {
    const raw = record[id];
    if (!raw || typeof raw !== "object") return [];
    const window = raw as Record<string, unknown>;
    const usedPercent = finiteNumber(window.utilization);
    if (usedPercent === undefined) return [];
    const bounded = boundedPercent(usedPercent);
    const resetsAt = isoFromDateString(window.resets_at);
    return [
      {
        id,
        label:
          id === "five_hour"
            ? "5-hour window"
            : id === "seven_day"
              ? "Weekly window"
              : id === "seven_day_sonnet"
                ? "Weekly Sonnet window"
                : "Weekly Opus window",
        usedPercent: bounded,
        remainingPercent: 100 - bounded,
        ...(resetsAt ? { resetsAt } : {}),
      },
    ];
  });
}

function isoFromDateString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return Option.match(DateTime.make(value), {
    onNone: () => undefined,
    onSome: DateTime.formatIso,
  });
}

function isoFromEpochMillis(value: unknown): string | undefined {
  const ms = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : finiteNumber(value);
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  return Option.match(DateTime.make(ms), {
    onNone: () => undefined,
    onSome: DateTime.formatIso,
  });
}

function boundedPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

const GROK_PERIOD_LABELS: Record<string, string> = {
  USAGE_PERIOD_TYPE_DAILY: "Daily window",
  USAGE_PERIOD_TYPE_WEEKLY: "Weekly window",
  USAGE_PERIOD_TYPE_MONTHLY: "Monthly window",
};

// Grok's `_x.ai/billing` extension reports one credit-usage percentage over
// the current billing period rather than ACP rate-limit windows.
export function normalizeGrokBillingRateLimits(
  value: unknown,
): ReadonlyArray<ProviderRateLimitWindow> {
  if (!value || typeof value !== "object") return [];
  const config = (value as Record<string, unknown>).config;
  if (!config || typeof config !== "object") return [];
  const record = config as Record<string, unknown>;
  const usedPercent = finiteNumber(record.creditUsagePercent);
  if (usedPercent === undefined) return [];
  const bounded = boundedPercent(usedPercent);
  const period =
    record.currentPeriod && typeof record.currentPeriod === "object"
      ? (record.currentPeriod as Record<string, unknown>)
      : undefined;
  const label =
    (typeof period?.type === "string" ? GROK_PERIOD_LABELS[period.type] : undefined) ??
    "Billing window";
  const resetsAt = isoFromDateString(period?.end);
  return [
    {
      id: "billing-period",
      label,
      usedPercent: bounded,
      remainingPercent: 100 - bounded,
      ...(resetsAt ? { resetsAt } : {}),
    },
  ];
}

// Cursor's dashboard `GetCurrentPeriodUsage` reports included-usage
// percentages for the auto bucket and named-model (API) requests over the
// current billing cycle.
export function normalizeCursorUsageRateLimits(
  value: unknown,
): ReadonlyArray<ProviderRateLimitWindow> {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const individualUsage = record.individualUsage;
  const usageRecord =
    individualUsage && typeof individualUsage === "object"
      ? (individualUsage as Record<string, unknown>)
      : undefined;
  const summaryPlan = usageRecord?.plan;
  if (summaryPlan && typeof summaryPlan === "object") {
    const plan = summaryPlan as Record<string, unknown>;
    const percent = finiteNumber(plan.totalPercentUsed);
    if (percent !== undefined) {
      const bounded = boundedPercent(percent);
      const resetsAt = isoFromDateString(plan.resetDate ?? plan.resetsAt);
      return [
        {
          id: "included-usage",
          label: "Included usage",
          usedPercent: bounded,
          remainingPercent: 100 - bounded,
          ...(resetsAt ? { resetsAt } : {}),
        },
      ];
    }
  }
  const planUsage = record.planUsage;
  if (!planUsage || typeof planUsage !== "object") return [];
  const plan = planUsage as Record<string, unknown>;
  const autoPercent = finiteNumber(plan.autoPercentUsed);
  const apiPercent = finiteNumber(plan.apiPercentUsed);
  if (autoPercent === undefined && apiPercent === undefined) return [];
  const resetsAt = isoFromEpochMillis(record.billingCycleEnd);
  const window = (id: string, label: string, percent: number): ProviderRateLimitWindow => {
    const bounded = boundedPercent(percent);
    return {
      id,
      label,
      usedPercent: bounded,
      remainingPercent: 100 - bounded,
      ...(resetsAt ? { resetsAt } : {}),
    };
  };
  if (autoPercent !== undefined && apiPercent !== undefined && autoPercent !== apiPercent) {
    return [
      window("included-auto", "Included usage (Auto)", autoPercent),
      window("included-api", "Included usage (API)", apiPercent),
    ];
  }
  return [window("included-usage", "Included usage", autoPercent ?? apiPercent ?? 0)];
}

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
