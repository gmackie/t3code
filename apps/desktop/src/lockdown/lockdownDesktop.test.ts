import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn(), unhandle: vi.fn() },
}));

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopManagedPolicy from "../app/DesktopManagedPolicy.ts";
import { resolveDesktopBaseDir } from "../app/DesktopStatePaths.ts";
import { resolveUserDataPath } from "../app/DesktopUserData.ts";
import {
  getDesktopScheme,
  makeDesktopContentSecurityPolicy,
} from "../electron/ElectronProtocol.ts";
import * as AppleSpeech from "../speech/AppleSpeech.ts";
import * as DesktopSshEnvironment from "../ssh/DesktopSshEnvironment.ts";
import {
  layerAppleSpeechDisabled,
  layerSshEnvironmentDisabled,
  lockdownContentSecurityPolicy,
} from "./lockdownDesktop.ts";

const directive = (policy: string, name: string) =>
  policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `)) ?? "";

describe("T3 Code Locked desktop", () => {
  it("the renderer CSP allows only the app and servers on this machine", () => {
    const policy = makeDesktopContentSecurityPolicy({
      scheme: getDesktopScheme(false),
      clerkFrontendApiHostname: "clerk.t3.codes",
      assetDirectory: "/app",
    });
    assert.strictEqual(policy, lockdownContentSecurityPolicy("t3code-locked"));
    for (const name of [
      "script-src",
      "connect-src",
      "img-src",
      "media-src",
      "frame-src",
      "object-src",
    ]) {
      const sources = directive(policy, name).split(/\s+/).slice(1);
      assert.isNotEmpty(sources, name);
      for (const source of sources) {
        // Bare schemes (http:, https:, ws:, wss:) would allow every host.
        assert.notInclude(["http:", "https:", "ws:", "wss:", "*"], source, `${name} ${source}`);
        if (/^(?:https?|wss?):\/\//.test(source)) {
          assert.match(source, /^(?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\*$/, name);
        }
      }
    }
    assert.notInclude(policy, "clerk");
    assert.notInclude(policy, "challenges.cloudflare.com");
  });

  it("uses its own protocol scheme, data directory and profile", () =>
    Effect.gen(function* () {
      assert.strictEqual(getDesktopScheme(false), "t3code-locked");
      assert.strictEqual(getDesktopScheme(true), "t3code-locked-dev");
      assert.strictEqual(
        resolveDesktopBaseDir({
          homeDirectory: "/home/user",
          joinPath: (...parts) => parts.join("/"),
          t3Home: Option.none(),
        }),
        "/home/user/.t3-locked",
      );
      const userData = yield* resolveUserDataPath({
        appDataDirectory: "/nonexistent-app-data",
        isDevelopment: false,
        platform: "linux",
      });
      assert.strictEqual(userData, "/nonexistent-app-data/t3code-locked");
    }).pipe(Effect.provide(NodeServices.layer), Effect.runPromise));

  it.effect("Apple Speech never runs its asset-downloading helper", () =>
    Effect.gen(function* () {
      const speech = yield* AppleSpeech.AppleSpeech;
      assert.deepStrictEqual(yield* speech.supportedLocales, []);
      assert.deepStrictEqual(yield* speech.prepare("en-US"), { ok: false, code: "unavailable" });
    }).pipe(Effect.provide(layerAppleSpeechDisabled)),
  );

  it.effect("SSH environments cannot reach another machine", () =>
    Effect.gen(function* () {
      const ssh = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      assert.deepStrictEqual(yield* ssh.discoverHosts(), []);
      const resolved = yield* ssh.resolveHost("prod-box").pipe(Effect.flip);
      assert.match(resolved.message, /disabled in T3 Code Locked/);
      const ensured = yield* ssh
        .ensureEnvironment({
          alias: "prod-box",
          hostname: "prod-box",
          username: null,
          port: null,
        } as never)
        .pipe(Effect.flip);
      assert.match(ensured.message, /disabled in T3 Code Locked/);
    }).pipe(Effect.provide(layerSshEnvironmentDisabled)),
  );

  it.effect("the desktop reads the locked policy: local-only, no updates, no cookie import", () =>
    Effect.gen(function* () {
      const policy = yield* (yield* DesktopManagedPolicy.DesktopManagedPolicy).read;
      assert.isDefined(policy);
      const limits = policy!.document.limits;
      assert.deepStrictEqual(limits?.clients, ["desktop", "local-browser"]);
      assert.strictEqual(limits?.updates?.mode, "off");
      assert.strictEqual(limits?.connect, false);
      assert.strictEqual(limits?.telemetry, false);
      assert.strictEqual(limits?.browserCookieImport, false);
    }).pipe(
      Effect.provide(
        DesktopManagedPolicy.layer.pipe(
          Layer.provide(
            Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
              platform: "linux",
            } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
          ),
          Layer.provide(NodeServices.layer),
        ),
      ),
    ),
  );
});
