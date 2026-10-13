import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { make } from "./DesktopServerExposure.ts";

describe("locked-down desktop exposure", () => {
  it.effect("keeps loopback binding after network and Tailscale enable requests", () =>
    Effect.gen(function* () {
      const exposure = yield* make;
      yield* exposure.configureFromSettings({ port: 8123 });
      yield* exposure.setMode("network-accessible");
      yield* exposure.setTailscaleServeEnabled({ enabled: true, port: 8443 });
      expect(yield* exposure.backendConfig).toEqual({
        port: 8123,
        bindHost: "127.0.0.1",
        httpBaseUrl: new URL("http://127.0.0.1:8123"),
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      });
      expect(yield* exposure.getAdvertisedEndpoints).toEqual([]);
      expect((yield* exposure.getState).mode).toBe("local-only");
    }),
  );
});
