import { assert, describe, it } from "@effect/vitest";
import * as ForgeGraphApi from "@t3tools/source-control-forgegraph/server/ForgeGraphApi";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSettings from "../serverSettings.ts";
import * as ForgeGraphSignIn from "./ForgeGraphSignIn.ts";

const SERVER = "https://forgegraf.com";

const pending = (operation: string, code: string) =>
  new ForgeGraphApi.ForgeGraphApiError({
    operation,
    status: 400,
    reason: "failed",
    code,
    detail: code,
  });

/**
 * ForgeGraph's device endpoints, answering each poll from `polls` in turn and recording every
 * request. `whoami` names the account once a token exists.
 */
function fakeApi(polls: ReadonlyArray<"pending" | "denied" | "token">) {
  const sent: Array<{
    readonly path: string;
    readonly body: unknown;
    readonly authenticated: boolean;
  }> = [];
  let poll = 0;
  const layer = Layer.mock(ForgeGraphApi.ForgeGraphApi)({
    server: Effect.succeed(SERVER),
    request: (input) => {
      sent.push({
        path: input.path,
        body: input.body,
        authenticated: input.authenticated !== false,
      });
      switch (input.path) {
        case "/auth/device":
          return Effect.succeed(
            JSON.stringify({
              device_code: "device-1",
              user_code: "ABCD-EFGH",
              verification_uri: `${SERVER}/device`,
              expires_in: 600,
              interval: 5,
            }),
          );
        case "/auth/device/poll": {
          const answer = polls[poll++] ?? "pending";
          return answer === "token"
            ? Effect.succeed(JSON.stringify({ access_token: "fg_device", token_type: "bearer" }))
            : Effect.fail(
                pending(
                  input.operation,
                  answer === "denied" ? "access_denied" : "authorization_pending",
                ),
              );
        }
        case "/fg/whoami":
          return Effect.succeed(JSON.stringify({ user: "gmackie", userId: "u-1" }));
        default:
          return Effect.die(`unexpected ${input.path}`);
      }
    },
  });
  return { layer, sent };
}

const withSignIn = (api: ReturnType<typeof fakeApi>) =>
  Effect.provide(
    ForgeGraphSignIn.layer.pipe(
      Layer.provideMerge(ServerSettings.layerTest()),
      Layer.provideMerge(api.layer),
    ),
  );

/** Lets the poll fiber take `polls` turns of its five-second interval. */
const advance = (polls: number) =>
  Effect.gen(function* () {
    for (let index = 0; index < polls; index++) yield* TestClock.adjust(Duration.seconds(5));
  });

describe("ForgeGraphSignIn", () => {
  it.effect("saves the approved token pinned to the server that issued it", () => {
    const api = fakeApi(["pending", "token"]);
    return Effect.gen(function* () {
      const signIn = yield* ForgeGraphSignIn.ForgeGraphSignIn;
      const settings = yield* ServerSettings.ServerSettingsService;
      const started = yield* signIn.start;
      assert.deepInclude(started, {
        phase: "waiting",
        userCode: "ABCD-EFGH",
        verificationUrl: `${SERVER}/device`,
      });
      // Asking again while the code waits answers with the same code, not a second one.
      assert.strictEqual((yield* signIn.start).userCode, "ABCD-EFGH");
      yield* advance(2);
      assert.deepInclude(yield* signIn.status, { phase: "succeeded", account: "gmackie" });
      assert.deepStrictEqual((yield* settings.getSettings).sourceControlHosts.forgegraph, {
        serverUrl: SERVER,
        token: "fg_device",
      });
      assert.deepStrictEqual(
        api.sent
          .filter((request) => request.path.startsWith("/auth/"))
          .map((r) => [r.path, r.authenticated]),
        [
          ["/auth/device", false],
          ["/auth/device/poll", false],
          ["/auth/device/poll", false],
        ],
      );
      assert.deepStrictEqual(api.sent[0]?.body, { scope: "admin" });
    }).pipe(withSignIn(api));
  });

  it.effect("reports a denied code and saves nothing", () => {
    const api = fakeApi(["denied"]);
    return Effect.gen(function* () {
      const signIn = yield* ForgeGraphSignIn.ForgeGraphSignIn;
      const settings = yield* ServerSettings.ServerSettingsService;
      yield* signIn.start;
      yield* advance(1);
      assert.deepInclude(yield* signIn.status, { phase: "failed" });
      assert.isUndefined((yield* settings.getSettings).sourceControlHosts.forgegraph);
    }).pipe(withSignIn(api));
  });

  it.effect("stops polling when cancelled", () => {
    const api = fakeApi(["token"]);
    return Effect.gen(function* () {
      const signIn = yield* ForgeGraphSignIn.ForgeGraphSignIn;
      yield* signIn.start;
      assert.strictEqual((yield* signIn.cancel).phase, "cancelled");
      yield* advance(2);
      assert.strictEqual((yield* signIn.status).phase, "cancelled");
      assert.isFalse(api.sent.some((request) => request.path === "/auth/device/poll"));
    }).pipe(withSignIn(api));
  });

  it.effect("signs out by clearing only the token saved in T3", () => {
    const api = fakeApi(["token"]);
    return Effect.gen(function* () {
      const signIn = yield* ForgeGraphSignIn.ForgeGraphSignIn;
      const settings = yield* ServerSettings.ServerSettingsService;
      yield* signIn.start;
      yield* advance(1);
      const signedOut = yield* signIn.signOut;
      assert.strictEqual(signedOut.phase, "idle");
      assert.match(signedOut.message ?? "", /cannot revoke/u);
      assert.deepStrictEqual((yield* settings.getSettings).sourceControlHosts.forgegraph, {
        serverUrl: SERVER,
        token: "",
      });
    }).pipe(withSignIn(api));
  });
});
