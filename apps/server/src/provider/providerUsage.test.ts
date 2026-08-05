import { describe, expect, it } from "vite-plus/test";

import {
  ProviderUsageCache,
  normalizeProviderRateLimits,
  normalizeClaudeRateLimits,
  normalizeCodexRateLimits,
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
