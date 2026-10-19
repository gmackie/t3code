/**
 * ForgeGraphSignIn — signs this environment in to ForgeGraph with its device flow.
 *
 * The server asks ForgeGraph for a code, shows it to whichever client asked, and polls until the
 * code is approved in a browser; the token then goes into the server's secret store through the
 * same settings path a pasted token takes. Clients only ever see the user code and the link, so
 * signing in works the same from a remote browser or the mobile app.
 *
 * One attempt runs per environment. Starting again while one waits answers with the same code.
 *
 * @module sourceControl/ForgeGraphSignIn
 */
import { ForgeGraphSignInError, type ForgeGraphSignInState } from "@t3tools/contracts";
import * as ForgeGraphApi from "@t3tools/source-control-forgegraph/server/ForgeGraphApi";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ServerSettings from "../serverSettings.ts";

const KIND = "forgegraph";
/** ForgeGraph's own floor for the poll interval, and what `slow_down` adds to it (RFC 8628). */
const MIN_INTERVAL_SECONDS = 5;
const EXPIRED = "The code expired before it was approved. Start again.";

const DeviceCode = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.optional(Schema.Number),
});
const Token = Schema.Struct({ access_token: Schema.String });
const Whoami = Schema.Struct({ user: Schema.NullOr(Schema.String) });
const decodeDeviceCode = Schema.decodeEffect(Schema.fromJsonString(DeviceCode));
const decodeToken = Schema.decodeEffect(Schema.fromJsonString(Token));
const decodeWhoami = Schema.decodeEffect(Schema.fromJsonString(Whoami));

export class ForgeGraphSignIn extends Context.Service<
  ForgeGraphSignIn,
  {
    /** Asks ForgeGraph for a code to approve, or answers with the one already waiting. */
    readonly start: Effect.Effect<ForgeGraphSignInState, ForgeGraphSignInError>;
    readonly status: Effect.Effect<ForgeGraphSignInState>;
    /** Stops waiting for the code; nothing saved changes. */
    readonly cancel: Effect.Effect<ForgeGraphSignInState>;
    /** Forgets the token saved in T3. A token in FG_API_TOKEN or the forge CLI is left alone. */
    readonly signOut: Effect.Effect<ForgeGraphSignInState, ForgeGraphSignInError>;
  }
>()("t3/sourceControl/ForgeGraphSignIn") {}

const blank = (server: string): ForgeGraphSignInState => ({
  phase: "idle",
  server,
  userCode: null,
  verificationUrl: null,
  expiresAt: null,
  account: null,
  message: null,
});

const make = Effect.gen(function* () {
  const api = yield* ForgeGraphApi.ForgeGraphApi;
  const settings = yield* ServerSettings.ServerSettingsService;
  const poller = yield* FiberHandle.make<void, never>();
  const state = yield* Ref.make<ForgeGraphSignInState | null>(null);

  const current = Effect.gen(function* () {
    const saved = yield* Ref.get(state);
    return saved ?? blank(yield* api.server);
  });

  const settle = (patch: Partial<ForgeGraphSignInState>) =>
    Ref.update(state, (saved) => (saved === null ? saved : { ...saved, ...patch }));

  /** Polls until the code is approved, refused, or expired, then records how it ended. */
  const poll = Effect.fn("ForgeGraphSignIn.poll")(function* (input: {
    readonly server: string;
    readonly deviceCode: string;
    readonly intervalSeconds: number;
    readonly expiresAtMillis: number;
  }) {
    let interval = input.intervalSeconds;
    while ((yield* Clock.currentTimeMillis) < input.expiresAtMillis) {
      yield* Effect.sleep(Duration.seconds(interval));
      const answer = yield* api
        .request({
          operation: "pollDeviceAuthorization",
          method: "POST",
          path: "/auth/device/poll",
          body: { device_code: input.deviceCode },
          authenticated: false,
        })
        .pipe(Effect.flatMap(decodeToken), Effect.result);
      if (answer._tag === "Success") {
        const saved = yield* settings
          .updateSettings({
            // Pinned to the server that issued it, so the token is never sent anywhere else.
            sourceControlHosts: {
              [KIND]: { serverUrl: input.server, token: answer.success.access_token },
            },
          })
          .pipe(Effect.result);
        if (saved._tag === "Failure")
          // ForgeGraph issued a token T3 could not keep; it is reported, never logged.
          return yield* settle({
            phase: "failed",
            message: "Signed in, but the token could not be saved. Try again.",
          });
        const account = yield* api.request({ operation: "whoami", path: "/fg/whoami" }).pipe(
          Effect.flatMap(decodeWhoami),
          Effect.map((whoami) => whoami.user),
          Effect.orElseSucceed(() => null),
        );
        return yield* settle({
          phase: "succeeded",
          userCode: null,
          verificationUrl: null,
          expiresAt: null,
          account,
          message: null,
        });
      }
      const code = answer.failure._tag === "ForgeGraphApiError" ? answer.failure.code : null;
      if (code === "slow_down") interval += MIN_INTERVAL_SECONDS;
      else if (code === "access_denied")
        return yield* settle({ phase: "failed", message: "The sign-in was denied in ForgeGraph." });
      else if (code === "expired_token")
        return yield* settle({ phase: "failed", message: EXPIRED });
      // `authorization_pending`, an unreachable server, or a 5xx: ask again until the code expires.
    }
    yield* settle({ phase: "failed", message: EXPIRED });
  });

  const start = Effect.gen(function* () {
    const saved = yield* Ref.get(state);
    const server = yield* api.server;
    const now = yield* Clock.currentTimeMillis;
    if (
      saved?.phase === "waiting" &&
      saved.server === server &&
      saved.expiresAt !== null &&
      Date.parse(saved.expiresAt) > now
    )
      return saved;
    const code = yield* api
      .request({
        operation: "startDeviceAuthorization",
        method: "POST",
        path: "/auth/device",
        // `admin` is the user scope that can write; `read` cannot review or merge.
        body: { scope: "admin" },
        authenticated: false,
      })
      .pipe(
        Effect.flatMap(decodeDeviceCode),
        Effect.mapError(
          (cause) =>
            new ForgeGraphSignInError({
              operation: "start",
              detail:
                cause._tag === "ForgeGraphApiError"
                  ? cause.detail
                  : "ForgeGraph returned an unreadable sign-in code.",
            }),
        ),
      );
    const expiresAtMillis = now + code.expires_in * 1_000;
    const next: ForgeGraphSignInState = {
      phase: "waiting",
      server,
      userCode: code.user_code,
      verificationUrl: code.verification_uri,
      expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAtMillis)),
      account: null,
      message: null,
    };
    yield* Ref.set(state, next);
    yield* FiberHandle.run(
      poller,
      poll({
        server,
        deviceCode: code.device_code,
        intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, code.interval ?? MIN_INTERVAL_SECONDS),
        expiresAtMillis,
      }),
    );
    return next;
  });

  const cancel = Effect.gen(function* () {
    yield* FiberHandle.clear(poller);
    const saved = yield* Ref.get(state);
    if (saved?.phase === "waiting")
      yield* settle({ phase: "cancelled", userCode: null, verificationUrl: null, expiresAt: null });
    return yield* current;
  });

  const signOut = Effect.gen(function* () {
    yield* FiberHandle.clear(poller);
    yield* settings.updateSettings({ sourceControlHosts: { [KIND]: { token: "" } } }).pipe(
      Effect.mapError(
        () =>
          new ForgeGraphSignInError({
            operation: "sign-out",
            detail: "The saved ForgeGraph token could not be removed.",
          }),
      ),
    );
    const next: ForgeGraphSignInState = {
      ...blank(yield* api.server),
      message:
        "Signed out of T3 Code. ForgeGraph cannot revoke tokens yet, so it keeps working until you delete it in ForgeGraph.",
    };
    yield* Ref.set(state, next);
    return next;
  });

  return ForgeGraphSignIn.of({ start, status: current, cancel, signOut });
});

export const layer = Layer.effect(ForgeGraphSignIn, make);
