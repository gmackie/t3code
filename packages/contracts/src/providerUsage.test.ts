import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ProviderUsageSnapshot } from "./providerUsage.ts";

const decodeProviderUsageSnapshot = Schema.decodeUnknownPromise(ProviderUsageSnapshot);

describe("ProviderUsageSnapshot", () => {
  it("decodes optional quota fields without retaining raw provider data", async () => {
    const snapshot = await decodeProviderUsageSnapshot({
      environmentId: "env-1",
      providerInstanceId: "codex-work",
      driverKind: "codex",
      availability: "available",
      windows: [
        {
          id: "primary",
          label: "5-hour window",
          remainingPercent: 75,
          resetsAt: "2024-08-30T06:40:00.000Z",
        },
      ],
      source: "provider-event",
      raw: { shouldNot: "cross the contract" },
    });

    expect(snapshot).toEqual({
      environmentId: "env-1",
      providerInstanceId: "codex-work",
      driverKind: "codex",
      availability: "available",
      windows: [
        {
          id: "primary",
          label: "5-hour window",
          remainingPercent: 75,
          resetsAt: "2024-08-30T06:40:00.000Z",
        },
      ],
      source: "provider-event",
    });
  });
});
