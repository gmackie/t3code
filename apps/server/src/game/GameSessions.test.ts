import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as GameSessions from "./GameSessions.ts";
import * as GameTransport from "./GameTransport.ts";
import * as UnityHooks from "./UnityHooks.ts";
import * as HtmlRender from "../htmlRender/HtmlRender.ts";
import { gameReport } from "./gameReport.ts";
const catalog = { generation: "g", target: "editor" as const, hooks: [] };
const state = {
  generation: "g",
  controller: { owner: null, role: null },
  monitor: null,
  width: 960,
  height: 640,
  frameAgeMs: 10,
};
const target = { kind: "editor" as const, projectPath: "/tmp/game" };
const caller = {
  cwd: "/tmp/game",
  threadId: ThreadId.make("thread"),
  role: "human" as const,
  canOperate: true,
};
function fixture(calls: Record<string, unknown>[] = [], wrongTarget = false) {
  return GameSessions.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(UnityHooks.UnityHooks, {
          connect: () =>
            Effect.succeed({
              generation: "g",
              port: 5000,
              token: "private".repeat(8),
              protocol: 1,
            }),
          execute: () => Effect.die("Not used"),
          command: () => Effect.die("Not used"),
        }),
        Layer.succeed(GameTransport.GameTransport, {
          video: () => Effect.succeed(new Uint8Array([0, 0, 1, 7])),
          frame: () => Effect.succeed(new Uint8Array([1, 2])),
          command: (_, input) => {
            const value = input as Record<string, unknown>;
            calls.push(value);
            if (value.action === "catalog")
              return Effect.succeed({ ...catalog, target: wrongTarget ? "player" : "editor" });
            if (value.action === "state") return Effect.succeed(state);
            if (value.action === "acquire")
              return Effect.succeed({ lease: "lease", expiresInMs: 1500 });
            return Effect.succeed({ released: true });
          },
        }),
        Layer.succeed(HtmlRender.HtmlRender, {
          prepare: (html) => Effect.succeed(html),
          publish: () => Effect.die("Not used"),
          preview: () => Effect.die("Not used"),
        }),
      ),
    ),
  );
}
const open = (service: GameSessions.GameSessions["Service"], token: string) =>
  service
    .request(token, { action: "open", target })
    .pipe(Effect.map((value) => (value as { sessionId: string }).sessionId));
it.effect("isolates viewer sessions and never exposes bridge credentials", () =>
  Effect.gen(function* () {
    const service = yield* GameSessions.GameSessions;
    const a = yield* service.ticket(caller),
      b = yield* service.ticket(caller);
    const id = yield* open(service, a.token);
    const error = yield* service.frame(b.token, id).pipe(Effect.flip);
    expect(error.code).toBe("session_missing");
    expect(yield* service.frame(a.token, id)).toEqual(new Uint8Array([1, 2]));
    expect(yield* service.video(a.token, id)).toEqual(new Uint8Array([0, 0, 1, 7]));
    expect((yield* service.video(b.token, id).pipe(Effect.flip)).code).toBe("session_missing");
    expect(
      JSON.stringify(
        yield* service.request(a.token, { action: "state", sessionId: id, afterSequence: 0 }),
      ),
    ).not.toContain("private");
  }).pipe(Effect.provide(fixture())),
);
it.effect("requires operation scope and bounds sessions", () =>
  Effect.gen(function* () {
    const service = yield* GameSessions.GameSessions;
    const read = yield* service.ticket({ ...caller, canOperate: false });
    expect((yield* open(service, read.token).pipe(Effect.flip)).code).toBe("read_only");
    const own = yield* service.ticket(caller);
    for (let i = 0; i < 4; i++) yield* open(service, own.token);
    expect((yield* open(service, own.token).pipe(Effect.flip)).code).toBe("session_limit");
  }).pipe(Effect.provide(fixture())),
);
it.effect("invalidates expired tickets and their sessions", () =>
  Effect.gen(function* () {
    const service = yield* GameSessions.GameSessions;
    const own = yield* service.ticket(caller);
    const id = yield* open(service, own.token);
    yield* TestClock.adjust("61 minutes");
    expect((yield* service.frame(own.token, id).pipe(Effect.flip)).code).toBe("viewer_expired");
  }).pipe(Effect.provide(fixture())),
);
it.effect("rejects an incompatible target", () =>
  Effect.gen(function* () {
    const service = yield* GameSessions.GameSessions;
    const own = yield* service.ticket(caller);
    expect((yield* open(service, own.token).pipe(Effect.flip)).code).toBe("invalid_response");
  }).pipe(Effect.provide(fixture([], true))),
);
it.effect("requires this viewer's lease and releases it on close", () => {
  const calls: Record<string, unknown>[] = [];
  return Effect.gen(function* () {
    const service = yield* GameSessions.GameSessions;
    const own = yield* service.ticket(caller);
    const id = yield* open(service, own.token);
    const bad = yield* service
      .request(own.token, { action: "stop_monitor", sessionId: id, lease: "other" })
      .pipe(Effect.flip);
    expect(bad.code).toBe("control_lost");
    yield* service.request(own.token, { action: "acquire", sessionId: id, takeover: true });
    expect(calls.at(-1)?.owner).not.toBe(own.token);
    yield* service.request(own.token, { action: "close", sessionId: id });
    expect(calls.at(-1)?.action).toBe("release");
    expect((yield* service.frame(own.token, id).pipe(Effect.flip)).code).toBe("session_missing");
  }).pipe(Effect.provide(fixture(calls)));
});
it.effect("keeps agent sessions thread-bound and disallows human takeover semantics", () => {
  const calls: Record<string, unknown>[] = [];
  return Effect.gen(function* () {
    const service = yield* GameSessions.GameSessions;
    const result = yield* service.agentRequest(caller.threadId, { action: "open", target });
    const sessionId = (result as { sessionId: string }).sessionId;
    yield* service.agentRequest(caller.threadId, { action: "acquire", sessionId, takeover: true });
    expect(calls.at(-1)).toMatchObject({ role: "agent", takeover: false });
    expect(
      (yield* service
        .agentRequest(ThreadId.make("other"), { action: "state", sessionId, afterSequence: 0 })
        .pipe(Effect.flip)).code,
    ).toBe("session_missing");
  }).pipe(Effect.provide(fixture(calls)));
});
it("escapes report data and handles empty observations", () => {
  const html = gameReport({ ...catalog, generation: '<script>alert("x")</script>' }, state);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("NaN");
  expect(html).not.toContain("Infinity");
});

it("reports vector histories per component and enum observations without executing labels", () => {
  const descriptor = {
    description: "Observed gameplay",
    unit: null,
    writable: true,
    minimum: null,
    maximum: null,
  };
  const html = gameReport(
    {
      ...catalog,
      hooks: [
        { ...descriptor, key: "position", handle: "p", type: "vector", components: 3 },
        { ...descriptor, key: "mode", handle: "m", type: "enum", choices: ["Walk", "Run"] },
      ],
    },
    {
      ...state,
      monitor: {
        id: "watch",
        generation: "g",
        status: "stopped",
        error: null,
        dropped: 0,
        samples: [
          { generation: "g", sequence: 1, sampledAtMs: 0, values: { p: [0, 10, -2], m: "Walk" } },
          {
            generation: "g",
            sequence: 2,
            sampledAtMs: 100,
            values: { p: [1, 5, -2], m: "<img src=x>" },
          },
        ],
      },
    },
  );
  expect(html).toContain("[1,5,-2]");
  expect(html).toContain('points="0.00,55.00 300.00,5.00"');
  expect(html).toContain('points="0.00,5.00 300.00,55.00"');
  expect(html.match(/<polyline /g)).toHaveLength(3);
  expect(html).toContain("&lt;img src=x&gt;");
  expect(html).not.toContain("<img");
});

it.effect("returns an image for an agent's own session and rejects another thread", () =>
  Effect.gen(function* () {
    const service = yield* GameSessions.GameSessions;
    const result = yield* service.agentRequest(caller.threadId, { action: "open", target });
    const id = (result as { sessionId: string }).sessionId;
    const frame = yield* service.agentSnapshot(caller.threadId, id);
    expect(frame.screenshot).toMatchObject({
      mimeType: "image/jpeg",
      data: "AQI=",
      width: 960,
      height: 640,
    });
    expect(
      (yield* service.agentSnapshot(ThreadId.make("unrelated"), id).pipe(Effect.flip)).code,
    ).toBe("viewer_expired");
  }).pipe(Effect.provide(fixture())),
);

it("reports mutation outcomes, deduplicated receipt identities and recoverable raw evidence", () => {
  const sample = {
    generation: "g",
    sequence: 2,
    sampledAtMs: 10,
    values: { speed: 8 },
    mutation: {
      id: "mutation",
      handle: "speed",
      before: 3,
      requested: 9,
      outcome: "adjusted" as const,
    },
  };
  const observed = {
    ...state,
    monitor: {
      id: "watch",
      generation: "g",
      status: "active" as const,
      error: null,
      dropped: 1,
      samples: [sample],
      predicate: { handle: "speed", operator: "gt" as const, expected: 7 },
      armed: false,
      receipts: [{ id: "receipt", arm: 1, sample }],
    },
  };
  const html = gameReport(catalog, observed);
  expect(html).toContain("adjusted");
  expect(html).toContain("not armed");
  const raw = html.match(/<pre>([\s\S]*?)<\/pre>/)?.[1];
  expect(raw).toBeDefined();
  const decoded = raw!
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  expect(JSON.parse(decoded)).toEqual({ schema: "t3.unity-evidence/v1", catalog, state: observed });
});
