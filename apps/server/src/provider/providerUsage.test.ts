import { describe, expect, it } from "vite-plus/test";

import {
  ProviderUsageCache,
  normalizeProviderRateLimits,
  normalizeClaudeRateLimits,
  normalizeCodexRateLimits,
  normalizeCursorUsageRateLimits,
  normalizeGrokBillingRateLimits,
  toProviderUsageSnapshot,
} from "./providerUsage.ts";

describe("normalizeProviderRateLimits", () => {
  it("normalizes Codex windows without exposing the provider payload", () => {
    expect(
      normalizeProviderRateLimits({
        primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_725_000_000 },
        secondary: { usedPercent: 8, windowDurationMins: 10_080, resetsAt: 1_725_100_000 },
      }),
    ).toEqual([
      {
        id: "primary",
        label: "5-hour window",
        usedPercent: 42,
        remainingPercent: 58,
        resetsAt: "2024-08-30T06:40:00.000Z",
      },
      {
        id: "secondary",
        label: "Weekly window",
        usedPercent: 8,
        remainingPercent: 92,
        resetsAt: "2024-08-31T10:26:40.000Z",
      },
    ]);
  });

  it("returns no fabricated windows for an unsupported payload", () => {
    expect(normalizeProviderRateLimits({ status: "unknown" })).toEqual([]);
  });

  it("normalizes a provider blocking window when only reset metadata is available", () => {
    expect(
      normalizeProviderRateLimits({
        rate_limit_type: "five_hour",
        status: "rejected",
        resetsAt: 1_725_000_000,
      }),
    ).toEqual([
      {
        id: "five_hour",
        label: "5-hour window",
        resetsAt: "2024-08-30T06:40:00.000Z",
        isBlocking: true,
      },
    ]);
  });

  it("accepts already-sanitized adapter windows without reintroducing raw fields", () => {
    expect(
      normalizeCodexRateLimits([
        {
          id: "primary",
          label: "5-hour window",
          remainingPercent: 22,
          isBlocking: false,
          raw: { secret: "removed" },
        },
      ]),
    ).toEqual([{ id: "primary", label: "5-hour window", remainingPercent: 22 }]);
    expect(normalizeClaudeRateLimits({ status: "unknown" })).toEqual([]);
  });

  it("normalizes Claude's authenticated OAuth usage response", () => {
    expect(
      normalizeClaudeRateLimits({
        five_hour: { utilization: 41, resets_at: "2026-08-21T15:00:00Z" },
        seven_day: { utilization: 12, resets_at: "2026-08-25T15:00:00Z" },
      }),
    ).toEqual([
      {
        id: "five_hour",
        label: "5-hour window",
        usedPercent: 41,
        remainingPercent: 59,
        resetsAt: "2026-08-21T15:00:00.000Z",
      },
      {
        id: "seven_day",
        label: "Weekly window",
        usedPercent: 12,
        remainingPercent: 88,
        resetsAt: "2026-08-25T15:00:00.000Z",
      },
    ]);
  });

  it("normalizes Claude SDK rejected rate-limit events as blocking quota windows", () => {
    expect(
      normalizeClaudeRateLimits({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          resetsAt: 1_787_486_400,
          rateLimitType: "seven_day",
          overageStatus: "rejected",
        },
      }),
    ).toEqual([
      {
        id: "seven_day",
        label: "Weekly window",
        resetsAt: "2026-08-23T12:00:00.000Z",
        isBlocking: true,
      },
    ]);
  });

  it("keeps usage snapshots isolated by environment and provider instance", () => {
    const cache = new ProviderUsageCache("env-1", () => "2024-08-30T06:40:00.000Z");
    const snapshot = toProviderUsageSnapshot({
      environmentId: "env-1",
      providerInstanceId: "codex-work",
      driverKind: "codex",
      windows: [{ id: "primary", label: "5-hour window", remainingPercent: 70 }],
      source: "provider-event",
      updatedAt: "2024-08-30T06:40:00.000Z",
    });

    cache.set(snapshot);

    expect(cache.get("codex-work")).toEqual(snapshot);
    expect(cache.get("codex-personal", "codex").availability).toBe("unavailable");
    expect(cache.get("codex-personal", "codex").driverKind).toBe("codex");
  });

  it("normalizes a Grok billing response into a single period window", () => {
    expect(
      normalizeGrokBillingRateLimits({
        config: {
          creditUsagePercent: 8,
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            start: "2026-08-17T21:58:02.042827+00:00",
            end: "2026-08-24T21:58:02.042827+00:00",
          },
        },
        subscription_tier: "SuperGrok Heavy",
      }),
    ).toEqual([
      {
        id: "billing-period",
        label: "Weekly window",
        usedPercent: 8,
        remainingPercent: 92,
        resetsAt: "2026-08-24T21:58:02.042Z",
      },
    ]);
  });

  it("labels unknown Grok billing periods generically and clamps overage", () => {
    expect(
      normalizeGrokBillingRateLimits({
        config: { creditUsagePercent: 130, currentPeriod: { type: "USAGE_PERIOD_TYPE_UNKNOWN" } },
      }),
    ).toEqual([
      { id: "billing-period", label: "Billing window", usedPercent: 100, remainingPercent: 0 },
    ]);
    expect(normalizeGrokBillingRateLimits({ config: {} })).toEqual([]);
    expect(normalizeGrokBillingRateLimits(null)).toEqual([]);
  });

  it("normalizes Cursor plan usage with distinct auto and API percentages", () => {
    expect(
      normalizeCursorUsageRateLimits({
        billingCycleStart: "1784769683000",
        billingCycleEnd: "1787448083000",
        planUsage: { autoPercentUsed: 40, apiPercentUsed: 75, totalSpend: 1234 },
      }),
    ).toEqual([
      {
        id: "included-auto",
        label: "Included usage (Auto)",
        usedPercent: 40,
        remainingPercent: 60,
        resetsAt: "2026-08-23T01:21:23.000Z",
      },
      {
        id: "included-api",
        label: "Included usage (API)",
        usedPercent: 75,
        remainingPercent: 25,
        resetsAt: "2026-08-23T01:21:23.000Z",
      },
    ]);
  });

  it("collapses matching Cursor percentages into one window and ignores unusable payloads", () => {
    expect(
      normalizeCursorUsageRateLimits({
        billingCycleEnd: "1787448083000",
        planUsage: { autoPercentUsed: 100, apiPercentUsed: 100 },
      }),
    ).toEqual([
      {
        id: "included-usage",
        label: "Included usage",
        usedPercent: 100,
        remainingPercent: 0,
        resetsAt: "2026-08-23T01:21:23.000Z",
      },
    ]);
    expect(normalizeCursorUsageRateLimits({ planUsage: {} })).toEqual([]);
    expect(normalizeCursorUsageRateLimits({})).toEqual([]);
    expect(normalizeCursorUsageRateLimits(undefined)).toEqual([]);
  });

  it("normalizes Cursor's authenticated usage summary", () => {
    expect(
      normalizeCursorUsageRateLimits({
        individualUsage: {
          plan: {
            totalPercentUsed: 63,
            resetDate: "2026-09-01T00:00:00.000Z",
            breakdown: { total: 61 },
          },
        },
      }),
    ).toEqual([
      {
        id: "included-usage",
        label: "Included usage",
        usedPercent: 63,
        remainingPercent: 37,
        resetsAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
  });

  it("marks a cached snapshot stale after its freshness window", () => {
    let now = "2024-08-30T06:40:00.000Z";
    const cache = new ProviderUsageCache("env-1", () => now);
    cache.set(
      toProviderUsageSnapshot({
        environmentId: "env-1",
        providerInstanceId: "codex-work",
        driverKind: "codex",
        windows: [{ id: "primary", label: "5-hour window", remainingPercent: 70 }],
        source: "provider-event",
        updatedAt: "2024-08-30T06:40:00.000Z",
      }),
    );

    now = "2024-08-30T12:41:00.000Z";
    expect(cache.get("codex-work").availability).toBe("stale");
  });
});
