import * as NodeHttp2 from "node:http2";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as LiveActivityApns from "./LiveActivityApns.ts";
import { payloadFor, request } from "./LiveActivityApns.ts";

it.effect(
  "loads an operator's raw PEM as a redacted credential and rejects another app's bundle",
  () =>
    Effect.gen(function* () {
      for (const bundleId of ["com.gmacko.t3code", "com.example.other"]) {
        const configured = yield* LiveActivityApns.LiveActivityApns.pipe(
          Effect.flatMap((service) => service.configured),
          Effect.provide(
            LiveActivityApns.layer.pipe(
              Layer.provide(
                Layer.merge(
                  FileSystem.layerNoop({
                    readFileString: () =>
                      Effect.succeed(
                        JSON.stringify({
                          teamId: "TEAM",
                          keyId: "KEY",
                          privateKey: "raw-pem",
                          bundleId,
                          environment: "production",
                        }),
                      ),
                  }),
                  Path.layer,
                ),
              ),
            ),
          ),
        );
        assert.equal(configured, bundleId === "com.gmacko.t3code");
      }
    }),
);

it.effect("sends the ActivityKit payload and headers over HTTP/2 and exposes APNs rejection", () =>
  Effect.gen(function* () {
    const received: Array<{ headers: NodeHttp2.IncomingHttpHeaders; body: string }> = [];
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => NodeHttp2.createServer()),
      (server) =>
        Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    server.on("stream", (stream, headers) => {
      let body = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        body += chunk;
      });
      stream.on("end", () => {
        received.push({ headers, body });
        stream.respond({ ":status": 410 });
        stream.end(JSON.stringify({ reason: "Unregistered" }));
      });
    });
    yield* Effect.promise(
      () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
    );
    const address = server.address();
    assert.isObject(address);
    if (address === null || typeof address === "string") return;
    const delivery = {
      token: "a".repeat(64),
      event: "update" as const,
      state: {
        title: "T3 Code",
        subtitle: "Working",
        activeCount: 1,
        updatedAt: "2026-01-01T00:00:00Z",
        activities: [],
      },
    };
    const payload = payloadFor(delivery, 100);
    const result = yield* request({
      authority: `http://127.0.0.1:${address.port}`,
      authorization: "test-jwt",
      token: delivery.token,
      topic: "com.gmacko.t3code.push-type.liveactivity",
      payload,
      event: "update",
    });
    assert.deepEqual(result, { status: 410, reason: "Unregistered" });
    assert.equal(received[0]!.headers["apns-push-type"], "liveactivity");
    assert.equal(received[0]!.headers["apns-topic"], "com.gmacko.t3code.push-type.liveactivity");
    assert.equal(received[0]!.headers.authorization, "bearer test-jwt");
    const aps = JSON.parse(received[0]!.body).aps;
    assert.equal(aps["stale-date"], 700);
    assert.equal(aps["content-state"].name, "AgentActivity");
    assert.equal(JSON.parse(aps["content-state"].props).activeCount, 1);
    assert.equal(
      JSON.parse(payloadFor({ ...delivery, event: "end" }, 100)).aps["dismissal-date"],
      160,
    );
  }).pipe(Effect.scoped),
);

it("bounds multibyte widget payloads to Apple's 4 KiB limit", () => {
  const row = {
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make("thread"),
    projectTitle: "😀".repeat(120),
    threadTitle: "😀".repeat(120),
    modelTitle: "😀".repeat(120),
    phase: "running" as const,
    status: "Working",
    updatedAt: "2026-01-01T00:00:00Z",
    deepLink: "/thread",
  };
  const payload = payloadFor(
    {
      token: "token",
      event: "update",
      state: {
        title: "T3 Code",
        subtitle: "Working",
        activeCount: 5,
        updatedAt: row.updatedAt,
        activities: [row, row, row, row, row],
      },
    },
    100,
  );
  assert.isAtMost(Buffer.byteLength(payload), 4096);
  assert.isAbove(JSON.parse(JSON.parse(payload).aps["content-state"].props).activities.length, 0);
});
