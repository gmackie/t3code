import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  hasCloudPublicConfig,
  resolveCloudPublicConfig,
  resolveRelayTracingConfig,
} from "./publicConfig.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("T3 Code Locked web", () => {
  it("has no Clerk, relay or relay tracing even when a build baked them in", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_live_Y2xlcmsudDMuY29kZXMk");
    vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "t3-relay");
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.t3.codes");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_URL", "https://api.axiom.co/v1/traces");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_DATASET", "relay");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_TOKEN", "token");

    expect(resolveCloudPublicConfig()).toEqual({
      clerkPublishableKey: null,
      clerkJwtTemplate: null,
      relayUrl: null,
      relayTracing: { tracesUrl: null, tracesDataset: null, tracesToken: null },
    });
    expect(hasCloudPublicConfig()).toBe(false);
    expect(resolveRelayTracingConfig()).toBeNull();
  });
});
