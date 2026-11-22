import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { type ModelSelection, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderDriver, ProviderInstance } from "@t3tools/provider-core/server/driver";
import type { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { lockdownPolicyDocument } from "@t3tools/shared/lockdownEdition";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as TestClock from "effect/testing/TestClock";
import type * as Undici from "undici";

import * as ServerConfig from "../config.ts";
import { DESKTOP_RENDERER_ORIGINS } from "../httpCors.ts";
import { resolveBaseDir } from "../os-jank.ts";
import * as ManagedLimits from "../policy/managedLimits.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { managedUpdateRefusal } from "../policy/managedUpdates.ts";
import { BUILT_IN_DRIVERS } from "../provider/builtInDrivers.ts";
import * as ProviderMaintenanceRunner from "../provider/providerMaintenanceRunner.ts";
import { BUILT_IN_SOURCE_CONTROL_DRIVER_LIST } from "../sourceControl/sourceControlDefinitions.ts";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import { installLockdownEgressGuard } from "./lockdownEgress.ts";
import { lockdownOpenCodeDriver, lockdownSourceControlDrivers } from "./lockdownServer.ts";

const GATEWAY =
  "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/approved/compat";
const ALLOWED_MODEL = "cloudflare-locked/workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const codex = ProviderDriverKind.make("codex");
const opencode = ProviderDriverKind.make("opencode");

const lockedPolicy = ManagedPolicy.fromDocument(
  "/etc/t3code/policy.json",
  lockdownPolicyDocument(undefined, {}),
);

describe("T3 Code Locked server", () => {
  it.effect("the locked policy is valid and turns off every remote path it governs", () =>
    Effect.gen(function* () {
      const policy = yield* lockedPolicy;
      assert.strictEqual(ManagedPolicy.deniedBy(policy, "telemetry"), "T3 Code Locked");
      assert.strictEqual(ManagedPolicy.deniedBy(policy, "webhookTasks"), "T3 Code Locked");
      assert.isFalse(ManagedLimits.allowsConnect(policy));
      assert.isFalse(ManagedLimits.allowsRemoteClients(policy));
      assert.strictEqual(ManagedPolicy.deniedBy(policy, "previewTunnel"), "T3 Code Locked");
      assert.isTrue(policy.providers.isDriverAllowed(opencode));
      for (const driver of [
        "codex",
        "claudeAgent",
        "cursor",
        "grok",
        "pi",
        "antigravity",
        "muse",
      ]) {
        assert.isFalse(policy.providers.isDriverAllowed(ProviderDriverKind.make(driver)), driver);
      }
      assert.isDefined(managedUpdateRefusal(policy.document));
      assert.includeMembers(
        [...(policy.summary?.lockedSettings ?? [])],
        ["enableProviderUpdateChecks", "linkedEnvironmentsEnabled", "guestSharingEnabled"],
      );
    }),
  );

  it.effect("the server cannot listen beyond loopback or turn on Tailscale Serve", () =>
    Effect.gen(function* () {
      const policy = yield* lockedPolicy;
      const check = (host: string | undefined, tailscaleServeEnabled = false) =>
        ManagedLimits.checkServerReachability(policy, {
          authPolicy: "desktop-managed-local",
          host,
          tailscaleServeEnabled,
        }).pipe(Effect.result);
      assert.deepStrictEqual((yield* check(undefined))._tag, "Success");
      assert.strictEqual((yield* check("0.0.0.0"))._tag, "Failure");
      assert.strictEqual((yield* check("192.168.1.10"))._tag, "Failure");
      assert.strictEqual((yield* check("127.0.0.1", true))._tag, "Failure");
      const remote = yield* ManagedLimits.checkServerReachability(policy, {
        authPolicy: "remote-reachable",
        host: "0.0.0.0",
        tailscaleServeEnabled: false,
      }).pipe(Effect.result);
      assert.strictEqual(remote._tag, "Failure");
    }),
  );

  it.effect("the production policy layer applies the locked floor without any policy file", () =>
    Effect.gen(function* () {
      const policy = yield* ManagedPolicy.ManagedPolicy;
      assert.strictEqual(policy.document?.limits?.telemetry, false);
      assert.strictEqual(policy.document?.limits?.connect, false);
      assert.deepStrictEqual(policy.document?.limits?.providers?.allowedDrivers, [opencode]);
      assert.strictEqual(policy.document?.limits?.updates?.mode, "off");
    }).pipe(Effect.provide(ManagedPolicy.layer.pipe(Layer.provide(NodeServices.layer)))),
  );

  it.effect("analytics sends nothing under the locked policy even when telemetry is enabled", () =>
    Effect.gen(function* () {
      const sent: Array<string> = [];
      const client = HttpClient.make((request) => {
        sent.push(request.url);
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response(null, { status: 204 })),
        );
      });
      const layer = AnalyticsService.layer.pipe(
        Layer.provideMerge(
          ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-lockdown-" }),
        ),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              T3CODE_TELEMETRY_ENABLED: true,
              T3CODE_POSTHOG_KEY: "phc_test_key",
              T3CODE_POSTHOG_HOST: "http://localhost",
            }),
          ),
        ),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(HttpClient.HttpClient, client),
            Layer.effect(ManagedPolicy.ManagedPolicy, lockedPolicy),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const analytics = yield* AnalyticsService.AnalyticsService;
        for (let index = 0; index < 25; index += 1)
          yield* analytics.record("lockdown.test", { index });
        for (let second = 0; second < 60; second += 1) yield* TestClock.adjust("1 second");
        yield* analytics.flush;
      }).pipe(Effect.provide(layer));
      assert.deepStrictEqual(sent, []);
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it("constructs GitLab and no other source-control host", () => {
    assert.ok(BUILT_IN_SOURCE_CONTROL_DRIVER_LIST.some(({ kind }) => kind === "tanstack-source"));
    assert.deepStrictEqual(
      lockdownSourceControlDrivers(BUILT_IN_SOURCE_CONTROL_DRIVER_LIST).map(({ kind }) => kind),
      ["gitlab"],
    );
  });

  it.effect("refuses to install or update providers", () =>
    Effect.gen(function* () {
      const runner = yield* ProviderMaintenanceRunner.ProviderMaintenanceRunner;
      const result = yield* runner.updateProvider(opencode).pipe(Effect.flip);
      assert.match(result.reason, /does not install or update providers/);
      const other = yield* runner.updateProvider({ provider: codex }).pipe(Effect.flip);
      assert.strictEqual(other.provider, codex);
    }).pipe(
      // In the locked edition the layer needs nothing: the upstream runner's services are unused.
      Effect.provide(
        ProviderMaintenanceRunner.layer as unknown as Layer.Layer<ProviderMaintenanceRunner.ProviderMaintenanceRunner>,
      ),
    ),
  );

  it("uses its own renderer origins and data directory", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        [...DESKTOP_RENDERER_ORIGINS],
        ["t3code-locked://app", "t3code-locked-dev://app"],
      );
      const baseDir = yield* resolveBaseDir(undefined);
      assert.match(baseDir, /\/\.t3-locked$/);
    }).pipe(
      Effect.provide(NodeServices.layer),
      Effect.provideService(HostProcess.HomeDirectory, "/home/locked"),
      Effect.runPromise,
    ));

  it("in-process requests reach only loopback and approved hosts", async () => {
    const reached: Array<string> = [];
    const target = {
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        reached.push(String(input));
        return new Response("ok");
      }) as typeof fetch,
    };
    let composed: ((options: { origin: string }, handler: unknown) => unknown) | undefined;
    const installed: Array<unknown> = [];
    const fakeUndici = {
      getGlobalDispatcher: () => ({
        compose: (
          interceptor: (dispatch: (o: unknown, h: unknown) => unknown) => typeof composed,
        ) => {
          composed = interceptor(() => "dispatched");
          return "composed-dispatcher";
        },
      }),
      setGlobalDispatcher: (dispatcher: unknown) => installed.push(dispatcher),
    } as unknown as typeof Undici;
    installLockdownEgressGuard(
      { T3CODE_LOCKDOWN_ALLOWED_HOSTS: "gitlab.example.com" },
      () => fakeUndici,
      target,
    );
    assert.deepStrictEqual(installed, ["composed-dispatcher"]);
    for (const url of [
      "https://ingest.t3.codes/batch/",
      "https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json",
      "https://registry.npmjs.org/t3/latest",
      "https://collector.example.com/v1/traces",
    ]) {
      await target.fetch(url).then(
        () => assert.fail(`${url} was reachable`),
        (error: unknown) =>
          assert.strictEqual((error as { _tag?: string })._tag, "LockdownEgressBlockedError"),
      );
      assert.throws(() => composed!({ origin: new URL(url).origin }, {}), /blocked/);
    }
    await target.fetch("http://127.0.0.1:4096/global/health");
    await target.fetch("https://gitlab.example.com/api/v4/version");
    assert.deepStrictEqual(reached, [
      "http://127.0.0.1:4096/global/health",
      "https://gitlab.example.com/api/v4/version",
    ]);
    assert.strictEqual(composed!({ origin: "http://127.0.0.1:4096" }, {}), "dispatched");
  });
});

interface FakeConfig {
  readonly serverUrl: string;
}

const selection = (model: string): ModelSelection =>
  ({
    instanceId: ProviderInstanceId.make("opencode"),
    model,
    options: [],
  }) as unknown as ModelSelection;

const makeFakeDriver = () => {
  const calls: Array<string> = [];
  const environments: Array<ReadonlyArray<{ readonly name: string; readonly value: string }>> = [];
  const runtime = {
    ensureThread: () => Effect.sync(() => calls.push("ensureThread")),
    resumeThread: () => Effect.sync(() => calls.push("resumeThread")),
    forkThread: () => Effect.sync(() => calls.push("forkThread")),
    startTurn: () => Effect.sync(() => void calls.push("startTurn")),
    uploadFeedback: () => Effect.sync(() => calls.push("uploadFeedback")),
  };
  const textGeneration = Object.fromEntries(
    [
      "generateCommitMessage",
      "generatePrContent",
      "generateBranchName",
      "generateThreadTitle",
      "generateReviewGuide",
    ].map((name) => [name, () => Effect.sync(() => calls.push(name))]),
  );
  const driver = {
    driverKind: opencode,
    create: (input: {
      readonly environment: ReadonlyArray<{ readonly name: string; readonly value: string }>;
    }) =>
      Effect.sync(() => {
        environments.push(input.environment);
        return {
          orchestrationAdapter: {
            driver: opencode,
            openSession: () => Effect.sync(() => (calls.push("openSession"), runtime)),
          },
          textGeneration,
        } as unknown as ProviderInstance;
      }),
  } as unknown as ProviderDriver<FakeConfig>;
  return { driver: lockdownOpenCodeDriver(driver), calls, environments };
};

const createInput = (
  serverUrl = "",
  environment: ReadonlyArray<{ name: string; value: string; sensitive: boolean }> = [],
) =>
  ({
    instanceId: ProviderInstanceId.make("opencode"),
    displayName: undefined,
    enabled: true,
    environment,
    config: { serverUrl },
  }) as never;

describe("T3 Code Locked OpenCode", () => {
  const withGateway = Effect.provideService(HostProcess.Environment, {
    T3CODE_CLOUDFLARE_GATEWAY_URL: GATEWAY,
  });

  it.effect("the built-in OpenCode driver is the locked one", () =>
    Effect.gen(function* () {
      const builtIn = BUILT_IN_DRIVERS.find((driver) => driver.driverKind === opencode);
      assert.isDefined(builtIn);
      // The guard fails before the upstream driver needs any of its services.
      const create = builtIn!.create(
        createInput("http://127.0.0.1:4096"),
      ) as unknown as Effect.Effect<
        ProviderInstance,
        ProviderDriverError,
        import("effect/Scope").Scope
      >;
      const error = yield* create.pipe(Effect.scoped, Effect.flip);
      assert.match(error.detail, /Remote OpenCode servers are disabled/);
    }).pipe(withGateway),
  );

  it.effect("is unavailable without an approved gateway", () =>
    Effect.gen(function* () {
      const { driver, environments } = makeFakeDriver();
      const error = yield* driver.create(createInput()).pipe(Effect.scoped, Effect.flip);
      assert.match(error.detail, /T3CODE_CLOUDFLARE_GATEWAY_URL/);
      assert.deepStrictEqual(environments, []);
    }).pipe(Effect.provideService(HostProcess.Environment, {})),
  );

  it.effect("never connects to an OpenCode server URL, even on loopback", () =>
    Effect.gen(function* () {
      const { driver, environments } = makeFakeDriver();
      const error = yield* driver
        .create(createInput("http://127.0.0.1:4096"))
        .pipe(Effect.scoped, Effect.flip);
      assert.match(error.detail, /Remote OpenCode servers are disabled/);
      assert.deepStrictEqual(environments, []);
    }).pipe(withGateway),
  );

  it.effect("launches OpenCode with the locked configuration over the instance's own", () =>
    Effect.gen(function* () {
      const { driver, environments } = makeFakeDriver();
      yield* driver
        .create(
          createInput("", [
            {
              name: "OPENCODE_CONFIG_CONTENT",
              value: '{"enabled_providers":["openai"]}',
              sensitive: false,
            },
            { name: "OPENCODE_DISABLE_AUTOUPDATE", value: "false", sensitive: false },
            { name: "KEEP_ME", value: "1", sensitive: false },
          ]),
        )
        .pipe(Effect.scoped);
      const env = Object.fromEntries(environments[0]!.map(({ name, value }) => [name, value]));
      assert.strictEqual(env.KEEP_ME, "1");
      assert.strictEqual(env.OPENCODE_DISABLE_AUTOUPDATE, "true");
      assert.strictEqual(env.OPENCODE_DISABLE_MODELS_FETCH, "true");
      assert.strictEqual(env.OPENCODE_DISABLE_SHARE, "true");
      assert.deepStrictEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT!).enabled_providers, [
        "cloudflare-locked",
      ]);
      assert.strictEqual(
        environments[0]!.filter(({ name }) => name === "OPENCODE_CONFIG_CONTENT").length,
        1,
      );
    }).pipe(withGateway),
  );

  it.effect("rejects models outside the allowlist on every operation", () =>
    Effect.gen(function* () {
      const { driver, calls } = makeFakeDriver();
      const instance = yield* driver.create(createInput()).pipe(Effect.scoped);
      const adapter = instance.orchestrationAdapter;
      const denied = yield* adapter
        .openSession({ modelSelection: selection("anthropic/claude-sonnet-4") } as never)
        .pipe(Effect.scoped, Effect.flip);
      assert.match(denied.message, /outside the configured Workers AI allowlist/);
      assert.deepStrictEqual(calls, []);

      const runtime = yield* adapter
        .openSession({ modelSelection: selection(ALLOWED_MODEL) } as never)
        .pipe(Effect.scoped);
      assert.isUndefined(runtime.uploadFeedback);
      for (const operation of [
        "ensureThread",
        "resumeThread",
        "forkThread",
        "startTurn",
      ] as const) {
        const result = yield* (
          runtime[operation] as (input: unknown) => Effect.Effect<void, { message: string }>
        )({ modelSelection: selection("openai/gpt-5") }).pipe(Effect.flip);
        assert.match(result.message, /allowlist/, operation);
      }
      yield* runtime.startTurn({ modelSelection: selection(ALLOWED_MODEL) } as never);

      for (const operation of [
        "generateCommitMessage",
        "generatePrContent",
        "generateBranchName",
        "generateThreadTitle",
        "generateReviewGuide",
      ] as const) {
        const result = yield* (
          instance.textGeneration[operation] as (
            input: unknown,
          ) => Effect.Effect<void, { message: string }>
        )({ modelSelection: selection("openai/gpt-5") }).pipe(Effect.flip);
        assert.match(result.message, /allowlist/, operation);
      }
      yield* instance.textGeneration.generateThreadTitle({
        modelSelection: selection(ALLOWED_MODEL),
      } as never);
      assert.deepStrictEqual(calls, ["openSession", "startTurn", "generateThreadTitle"]);
    }).pipe(withGateway),
  );
});
