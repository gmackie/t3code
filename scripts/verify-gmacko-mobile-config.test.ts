import { describe, expect, it } from "vite-plus/test";

import { verifyGmackoMobileConfig } from "./verify-gmacko-mobile-config.ts";

const releaseConfig = {
  ios: { bundleIdentifier: "com.gmacko.t3code" },
  updates: { enabled: false },
  extra: {
    clerk: { publishableKey: "pk_live_test", jwtTemplate: "t3-relay" },
    relay: { url: "https://relay.t3.codes" },
  },
};

describe("GMACKO mobile release configuration", () => {
  it("rejects the missing configuration that hides T3 Connect in released apps", () => {
    expect(() => verifyGmackoMobileConfig(releaseConfig)).not.toThrow();
    for (const extra of [
      undefined,
      { ...releaseConfig.extra, clerk: { publishableKey: null, jwtTemplate: "t3-relay" } },
      { ...releaseConfig.extra, clerk: { publishableKey: "pk_live_test", jwtTemplate: null } },
      { ...releaseConfig.extra, relay: { url: null } },
      { ...releaseConfig.extra, relay: { url: "http://127.0.0.1:3773" } },
    ]) {
      expect(() => verifyGmackoMobileConfig({ ...releaseConfig, extra })).toThrow();
    }
  });

  it("rejects upstream identity and OTA configuration in a fork release", () => {
    expect(() =>
      verifyGmackoMobileConfig({
        ...releaseConfig,
        ios: { bundleIdentifier: "com.t3tools.t3code" },
      }),
    ).toThrow();
    expect(() =>
      verifyGmackoMobileConfig({ ...releaseConfig, updates: { enabled: true } }),
    ).toThrow();
  });
});
