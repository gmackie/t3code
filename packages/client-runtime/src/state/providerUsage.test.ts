import { describe, expect, it } from "vite-plus/test";

import {
  isProviderUsageBlocking,
  isProviderUsageStale,
  providerUsageRemainingPercent,
} from "./providerUsage.ts";
import type { ProviderUsageSnapshot } from "@t3tools/contracts";

const snapshot = (overrides: Partial<ProviderUsageSnapshot>): ProviderUsageSnapshot => ({
  environmentId: "env-1" as never,
  providerInstanceId: "codex-work" as never,
  driverKind: "codex" as never,
  availability: "available",
  windows: [],
  source: "provider-event",
  ...overrides,
});

describe("provider usage selectors", () => {
  it("selects the most constrained quota window", () => {
    expect(
      providerUsageRemainingPercent(
        snapshot({
          windows: [
            { id: "primary", label: "5-hour", remainingPercent: 61 },
            { id: "weekly", label: "Weekly", remainingPercent: 34 },
          ],
        }),
      ),
    ).toBe(34);
  });

  it("distinguishes blocking and stale snapshots", () => {
    expect(
      isProviderUsageBlocking(
        snapshot({ windows: [{ id: "primary", label: "5-hour", isBlocking: true }] }),
      ),
    ).toBe(true);
    expect(isProviderUsageStale(snapshot({ availability: "stale" }))).toBe(true);
  });
});
