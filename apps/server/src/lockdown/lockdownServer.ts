/**
 * lockdownServer - server choke points of T3 Code Locked (see `@t3tools/shared/lockdownEdition`):
 * the OpenCode driver wrapper, the GitLab-only source-control list and the disabled provider
 * updater. Each upstream file touches this module in one place, so daily merges of main stay small.
 *
 * @module lockdownServer
 */
import {
  type ModelSelection,
  ServerProviderUpdateError,
  TextGenerationError,
} from "@t3tools/contracts";
import type { ProviderDriver, ProviderInstance } from "@t3tools/provider-core/server/driver";
import { ProviderDriverError } from "@t3tools/provider-core/server/errors";
import {
  ProviderAdapterProtocolError,
  type ProviderAdapterV2,
  type ProviderAdapterV2SessionRuntime,
} from "@t3tools/provider-core/server/ProviderAdapter";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  isLockdownModelAllowed,
  LOCKDOWN_EDITION,
  lockdownOpenCodeEnvironment,
  lockdownOpenCodeProviders,
} from "@t3tools/shared/lockdownEdition";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { ProviderMaintenanceRunnerShape } from "../provider/providerMaintenanceRunner.ts";

/** GitLab is the only source-control host the locked edition talks to. */
const LOCKDOWN_SOURCE_CONTROL_KINDS: ReadonlySet<string> = new Set(["gitlab"]);

export function lockdownSourceControlDrivers<Driver extends { readonly kind: string }>(
  drivers: ReadonlyArray<Driver>,
): ReadonlyArray<Driver> {
  return LOCKDOWN_EDITION
    ? drivers.filter((driver) => LOCKDOWN_SOURCE_CONTROL_KINDS.has(driver.kind))
    : drivers;
}

const LOCKDOWN_PROVIDER_UPDATE_REFUSAL =
  "T3 Code Locked does not install or update providers; your administrator manages OpenCode.";

/** Updating a provider runs npm, brew or the provider's own updater; all of them reach out. */
export const lockdownProviderMaintenanceRunner: ProviderMaintenanceRunnerShape = {
  updateProvider: (target) =>
    Effect.fail(
      new ServerProviderUpdateError({
        provider: typeof target === "string" ? target : target.provider,
        reason: LOCKDOWN_PROVIDER_UPDATE_REFUSAL,
      }),
    ),
};

const OUTSIDE_ALLOWLIST = "Model is not from a provider signed in to OpenCode";

/** Every model-bearing adapter operation, including a model switch after the session opened. */
function restrictAdapterModels(
  adapter: ProviderAdapterV2["Service"],
  providers: ReadonlyArray<string>,
): ProviderAdapterV2["Service"] {
  const check = (selection: ModelSelection | undefined) =>
    selection === undefined || isLockdownModelAllowed(selection.model, providers)
      ? Effect.void
      : Effect.fail(
          new ProviderAdapterProtocolError({ driver: adapter.driver, detail: OUTSIDE_ALLOWLIST }),
        );
  const restrictRuntime = ({
    // Feedback uploads go to OpenCode's own service.
    uploadFeedback: _uploadFeedback,
    ...runtime
  }: ProviderAdapterV2SessionRuntime): ProviderAdapterV2SessionRuntime => ({
    ...runtime,
    ensureThread: (input) =>
      check(input.modelSelection).pipe(
        Effect.andThen(Effect.suspend(() => runtime.ensureThread(input))),
      ),
    resumeThread: (input) =>
      check(input.modelSelection).pipe(
        Effect.andThen(Effect.suspend(() => runtime.resumeThread(input))),
      ),
    forkThread: (input) =>
      check(input.modelSelection).pipe(
        Effect.andThen(Effect.suspend(() => runtime.forkThread(input))),
      ),
    startTurn: (input) =>
      check(input.modelSelection).pipe(
        Effect.andThen(Effect.suspend(() => runtime.startTurn(input))),
      ),
    ...(runtime.compactThread === undefined
      ? {}
      : {
          compactThread: (input) =>
            check(input.modelSelection).pipe(
              Effect.andThen(Effect.suspend(() => runtime.compactThread!(input))),
            ),
        }),
  });
  return {
    ...adapter,
    openSession: (input) =>
      check(input.modelSelection).pipe(
        Effect.andThen(Effect.suspend(() => adapter.openSession(input))),
        Effect.map(restrictRuntime),
      ),
  };
}

/** Commit messages, PR text, branch names, titles, review guides and dictation cleanup use approved models only. */
function restrictTextGenerationModels(
  service: ProviderTextGeneration,
  providers: ReadonlyArray<string>,
): ProviderTextGeneration {
  const guard =
    <Input extends { readonly modelSelection: ModelSelection }, A>(
      run: (input: Input) => Effect.Effect<A, TextGenerationError>,
    ) =>
    (input: Input) =>
      isLockdownModelAllowed(input.modelSelection.model, providers)
        ? Effect.suspend(() => run(input))
        : Effect.fail(
            new TextGenerationError({ operation: "selectModel", detail: `${OUTSIDE_ALLOWLIST}.` }),
          );
  return {
    generateCommitMessage: guard(service.generateCommitMessage),
    generatePrContent: guard(service.generatePrContent),
    generateBranchName: guard(service.generateBranchName),
    generateThreadTitle: guard(service.generateThreadTitle),
    generateReviewGuide: guard(service.generateReviewGuide),
    generateTranscriptionPostProcessing: guard(service.generateTranscriptionPostProcessing),
  };
}

/**
 * OpenCode's auth file as OpenCode itself finds it: `OPENCODE_AUTH_CONTENT`, else
 * `$XDG_DATA_HOME/opencode/auth.json` (default `~/.local/share`). A missing file reads as empty.
 */
const readOpenCodeAuthFile = Effect.fn("readOpenCodeAuthFile")(function* (
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (environment.OPENCODE_AUTH_CONTENT) return environment.OPENCODE_AUTH_CONTENT;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dataHome =
    environment.XDG_DATA_HOME ||
    path.join(
      environment.HOME || environment.USERPROFILE || (yield* HostProcess.HomeDirectory),
      ".local",
      "share",
    );
  return yield* fs.readFileString(path.join(dataHome, "opencode", "auth.json")).pipe(
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound" ? Effect.succeed("{}") : Effect.fail(error),
    }),
  );
});

/**
 * OpenCode as the locked edition runs it: always its own local child process (never a server
 * URL), with only the providers signed in to through its auth file enabled, and every operation
 * checked against them. With no signed-in provider the instance is unavailable.
 */
export function lockdownOpenCodeDriver<Config extends { readonly serverUrl: string }, R, UsageR>(
  driver: ProviderDriver<Config, R, UsageR>,
): ProviderDriver<Config, R | FileSystem.FileSystem | Path.Path, UsageR> {
  if (!LOCKDOWN_EDITION) return driver;
  return {
    ...driver,
    create: Effect.fn("lockdownOpenCodeDriver.create")(function* (input) {
      const fail = (detail: string, cause?: unknown) =>
        new ProviderDriverError({
          driver: driver.driverKind,
          instanceId: input.instanceId,
          detail,
          ...(cause === undefined ? {} : { cause }),
        });
      if (input.config.serverUrl.trim().length > 0) {
        return yield* fail("Remote OpenCode servers are disabled in T3 Code Locked.");
      }
      const hostEnvironment = yield* HostProcess.Environment;
      const environment: Record<string, string | undefined> = { ...hostEnvironment };
      for (const variable of input.environment) environment[variable.name] = variable.value;
      const authFile = yield* readOpenCodeAuthFile(environment).pipe(
        Effect.mapError((cause) => fail("Could not read OpenCode's auth file.", cause)),
      );
      const locked = yield* Effect.try({
        try: () => {
          const providers = lockdownOpenCodeProviders(authFile);
          return { providers, env: lockdownOpenCodeEnvironment(environment, providers) };
        },
        catch: (cause) =>
          fail(cause instanceof Error ? cause.message : "Invalid OpenCode configuration.", cause),
      });
      const instance: ProviderInstance = yield* driver.create({
        ...input,
        // Later entries win, so the locked values replace anything the instance set.
        environment: [
          ...input.environment.filter((variable) => !(variable.name in locked.env)),
          ...Object.entries(locked.env).map(([name, value]) => ({ name, value, sensitive: true })),
        ],
      });
      return {
        ...instance,
        orchestrationAdapter: restrictAdapterModels(
          instance.orchestrationAdapter,
          locked.providers,
        ),
        textGeneration: restrictTextGenerationModels(instance.textGeneration, locked.providers),
      } satisfies ProviderInstance;
    }),
  };
}
