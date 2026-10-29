import * as NodeHttp2 from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import { LiveActivityError } from "@t3tools/contracts";
import type { RelayAgentActivityAggregateState } from "@t3tools/contracts/relay";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const isLiveActivityError = Schema.is(LiveActivityError);
const decodeApnsResponse = Schema.decodeOption(
  Schema.fromJsonString(Schema.Struct({ reason: Schema.optional(Schema.String) })),
);
const Credentials = Schema.fromJsonString(
  Schema.Struct({
    teamId: Schema.NonEmptyString,
    keyId: Schema.NonEmptyString,
    privateKey: Schema.RedactedFromValue(Schema.NonEmptyString),
    bundleId: Schema.Literal("com.gmacko.t3code"),
    environment: Schema.Literals(["production", "sandbox"]),
  }),
);

export interface Delivery {
  readonly token: string;
  readonly event: "update" | "end";
  readonly state: RelayAgentActivityAggregateState;
}

export class LiveActivityApns extends Context.Service<
  LiveActivityApns,
  {
    readonly configured: Effect.Effect<boolean>;
    readonly send: (
      delivery: Delivery,
    ) => Effect.Effect<
      { readonly status: number; readonly reason: string | null },
      LiveActivityError
    >;
  }
>()("t3/notifications/LiveActivityApns") {}

/** One scoped HTTP/2 exchange, also exercised against a real local HTTP/2 server. */
export const request = Effect.fn("LiveActivityApns.request")(function* (input: {
  readonly authority: string;
  readonly token: string;
  readonly authorization: string;
  readonly topic: string;
  readonly payload: string;
  readonly event: "update" | "end";
}) {
  return yield* Effect.callback<{ status: number; reason: string | null }, LiveActivityError>(
    (resume) => {
      const client = NodeHttp2.connect(input.authority);
      const fail = (cause: unknown) => {
        client.destroy();
        resume(Effect.fail(new LiveActivityError({ cause })));
      };
      client.on("error", fail);
      const stream = client.request({
        ":method": "POST",
        ":path": `/3/device/${input.token}`,
        authorization: `bearer ${input.authorization}`,
        "apns-topic": input.topic,
        "apns-push-type": "liveactivity",
        "apns-priority": input.event === "end" ? "10" : "5",
        "apns-expiration": "0",
      });
      let status = 0;
      let body = "";
      stream.setEncoding("utf8");
      stream.on("response", (headers) => {
        status = Number(headers[":status"]);
      });
      stream.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 4096) stream.destroy(new Error("APNs response exceeds limit"));
      });
      stream.on("error", fail);
      stream.on("end", () => {
        client.close();
        const parsed = decodeApnsResponse(body);
        resume(
          Effect.succeed({
            status,
            reason: Option.isSome(parsed) ? (parsed.value.reason ?? null) : null,
          }),
        );
      });
      stream.end(input.payload);
      return Effect.sync(() => {
        stream.destroy();
        client.destroy();
      });
    },
  ).pipe(
    Effect.timeout("15 seconds"),
    Effect.mapError((cause) =>
      isLiveActivityError(cause) ? cause : new LiveActivityError({ cause }),
    ),
  );
});

export function payloadFor(delivery: Delivery, timestamp: number): string {
  let activities = [...delivery.state.activities];
  const encode = () =>
    JSON.stringify({
      aps: {
        timestamp,
        event: delivery.event,
        "content-state": {
          name: "AgentActivity",
          props: JSON.stringify({ ...delivery.state, activities }),
        },
        ...(delivery.event === "end"
          ? { "dismissal-date": timestamp + 60 }
          : { "stale-date": timestamp + 10 * 60 }),
      },
    });
  let payload = encode();
  // APNs limits the entire UTF-8 payload to 4 KiB, including double-encoded widget props.
  while (Buffer.byteLength(payload) > 4096 && activities.length > 0) {
    activities = activities.slice(0, -1);
    payload = encode();
  }
  return payload;
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configuredPath = yield* Config.String("T3CODE_APNS_CONFIG").pipe(Config.option);
  const home = yield* Config.String("HOME").pipe(Config.withDefault(""));
  const configPath = Option.getOrElse(configuredPath, () =>
    path.join(home, ".config", "t3code", "apns.json"),
  );
  const credentials = yield* fs.readFileString(configPath).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Credentials)),
    Effect.asSome,
    Effect.orElseSucceed(() => Option.none()),
  );
  let cached: { readonly jwt: string; readonly issuedAt: number } | null = null;
  const send = Effect.fn("LiveActivityApns.send")(function* (delivery: Delivery) {
    if (Option.isNone(credentials))
      return yield* new LiveActivityError({ cause: "APNs not configured" });
    const config = credentials.value;
    const seconds = Math.floor((yield* DateTime.now).epochMilliseconds / 1000);
    if (!cached || seconds < cached.issuedAt || seconds - cached.issuedAt >= 45 * 60) {
      const jwt = yield* Effect.tryPromise({
        try: async () =>
          new SignJWT({})
            .setProtectedHeader({ alg: "ES256", kid: config.keyId })
            .setIssuer(config.teamId)
            .setIssuedAt(seconds)
            .sign(await importPKCS8(Redacted.value(config.privateKey), "ES256")),
        catch: (cause) => new LiveActivityError({ cause }),
      });
      cached = { jwt, issuedAt: seconds };
    }
    return yield* request({
      authority:
        config.environment === "production"
          ? "https://api.push.apple.com"
          : "https://api.sandbox.push.apple.com",
      token: delivery.token,
      authorization: cached.jwt,
      topic: `${config.bundleId}.push-type.liveactivity`,
      payload: payloadFor(delivery, seconds),
      event: delivery.event,
    });
  });
  return LiveActivityApns.of({ configured: Effect.succeed(Option.isSome(credentials)), send });
});

export const layer = Layer.effect(LiveActivityApns, make);
