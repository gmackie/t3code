import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS,
  resolveNetworkFamilyAttemptTimeout,
} from "./networkFamilyAutoselection.ts";

const base = {
  envOverride: undefined,
  nodeOptions: undefined,
  execArgv: [],
  currentDefaultMs: 250,
} as const;

describe("resolveNetworkFamilyAttemptTimeout", () => {
  it("raises Node's 250 ms default when nothing is configured", () => {
    expect(resolveNetworkFamilyAttemptTimeout(base)).toEqual({
      timeoutMs: DEFAULT_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS,
      invalidOverride: null,
    });
  });

  it("leaves a default that is already at least as generous", () => {
    expect(resolveNetworkFamilyAttemptTimeout({ ...base, currentDefaultMs: 5_000 }).timeoutMs).toBe(
      null,
    );
  });

  it.each([
    [
      "NODE_OPTIONS with =",
      {
        nodeOptions: "--max-old-space-size=4096 --network-family-autoselection-attempt-timeout=500",
      },
    ],
    [
      "NODE_OPTIONS with a separate value",
      { nodeOptions: "--network-family-autoselection-attempt-timeout 500" },
    ],
    [
      "NODE_OPTIONS with underscores",
      { nodeOptions: "--network_family_autoselection_attempt_timeout=500" },
    ],
    ["execArgv", { execArgv: ["--network-family-autoselection-attempt-timeout=500"] }],
  ])("respects an explicit Node flag in %s", (_label, overrides) => {
    expect(
      resolveNetworkFamilyAttemptTimeout({ ...base, currentDefaultMs: 500, ...overrides }),
    ).toEqual({ timeoutMs: null, invalidOverride: null });
  });

  it("applies a valid env override, even over an explicit Node flag", () => {
    expect(
      resolveNetworkFamilyAttemptTimeout({
        ...base,
        envOverride: " 4000 ",
        execArgv: ["--network-family-autoselection-attempt-timeout=500"],
      }),
    ).toEqual({ timeoutMs: 4_000, invalidOverride: null });
  });

  it("accepts Node's 10 ms minimum and skips a no-op override", () => {
    expect(resolveNetworkFamilyAttemptTimeout({ ...base, envOverride: "10" }).timeoutMs).toBe(10);
    expect(resolveNetworkFamilyAttemptTimeout({ ...base, envOverride: "250" }).timeoutMs).toBe(
      null,
    );
  });

  it.each(["9", "0", "-100", "1.5", "2s", "abc", "99999999999999999999"])(
    "ignores the invalid env override %s and falls back to the default",
    (envOverride) => {
      expect(resolveNetworkFamilyAttemptTimeout({ ...base, envOverride })).toEqual({
        timeoutMs: DEFAULT_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS,
        invalidOverride: envOverride,
      });
    },
  );

  it("treats a blank env override as unset", () => {
    expect(resolveNetworkFamilyAttemptTimeout({ ...base, envOverride: "  " })).toEqual({
      timeoutMs: DEFAULT_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS,
      invalidOverride: null,
    });
  });
});
