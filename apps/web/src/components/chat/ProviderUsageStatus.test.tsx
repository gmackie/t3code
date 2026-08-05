import { describe, expect, it } from "vite-plus/test";

import { statusLabel } from "./ProviderUsageStatus.tsx";

const base = {
  environmentId: "env-1" as never,
  providerInstanceId: "codex-work" as never,
  driverKind: "codex" as never,
  source: "provider-event" as const,
  windows: [],
} as const;

describe("statusLabel", () => {
  it("renders a blocking quota with its semantic label", () => {
    expect(
      statusLabel({
        ...base,
        availability: "available",
        windows: [{ id: "primary", label: "5-hour window", isBlocking: true }],
      }),
    ).toBe("Provider limit reached");
  });

  it("distinguishes unavailable quota from zero quota", () => {
    expect(statusLabel({ ...base, availability: "unavailable", windows: [] })).toBe(
      "Quota unavailable",
    );
    expect(statusLabel({ ...base, availability: "available", windows: [] })).toBe("Provider quota");
  });
});
