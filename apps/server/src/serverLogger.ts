import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as References from "effect/References";
import * as ServerConfig from "./config.ts";

/** Logs remain local even when legacy state contains an OTLP collector URL. */
export const ServerLoggerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return Layer.mergeAll(
      Logger.layer([Logger.consolePretty(), Logger.tracerLogger], { mergeWithExisting: false }),
      Layer.succeed(References.MinimumLogLevel, config.logLevel),
    );
  }),
);
