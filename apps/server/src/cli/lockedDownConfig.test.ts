import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { resolveServerConfig } from "./config.ts";

it.effect("ignores remote exposure requests from CLI and environment", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-locked-config-" });
    const config = yield* resolveServerConfig(
      {
        mode: Option.some("desktop"),
        port: Option.some(4888),
        baseDir: Option.some(baseDir),
        cwd: Option.none(),
        devUrl: Option.none(),
        noBrowser: Option.some(true),
        bootstrapFd: Option.none(),
        autoBootstrapProjectFromCwd: Option.some(false),
        logWebSocketEvents: Option.some(false),
        host: Option.some("0.0.0.0"),
        tailscaleServeEnabled: Option.some(true),
        tailscaleServePort: Option.some(8443),
      },
      Option.none(),
    );
    expect(config.host).toBe("127.0.0.1");
    expect(config.tailscaleServeEnabled).toBe(false);
    expect(config.tailscaleServePort).toBe(443);
    expect(config.otlpLogsUrl).toBeUndefined();
    expect(config.otlpMetricsUrl).toBeUndefined();
    expect(config.otlpTracesUrl).toBeUndefined();
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NetService.layer,
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              T3CODE_HOST: "0.0.0.0",
              T3CODE_OTLP_LOGS_URL: "https://collector.example/v1/logs",
              T3CODE_OTLP_TRACES_URL: "https://collector.example/v1/traces",
              T3CODE_OTLP_METRICS_URL: "https://collector.example/v1/metrics",
              OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
              T3CODE_TAILSCALE_SERVE: "true",
              T3CODE_TAILSCALE_SERVE_PORT: "8443",
            },
          }),
        ),
      ),
    ),
    Effect.scoped,
  ),
);
