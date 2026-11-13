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
  LOCKDOWN_EDITION,
  lockdownAllowedModelSlugs,
  lockdownOpenCodeEnvironment,
} from "@t3tools/shared/lockdownEdition";
import * as Effect from "effect/Effect";

import type { ProviderMaintenanceRunnerShape } from "../provider/providerMaintenanceRunner.ts";

/** GitLab is the only source-control host the locked edition talks to. */
export const LOCKDOWN_SOURCE_CONTROL_KINDS: ReadonlySet<string> = new Set(["gitlab"]);

export function lockdownSourceControlDrivers<Driver extends { readonly kind: string }>(
  drivers: ReadonlyArray<Driver>,
): ReadonlyArray<Driver> {
  return LOCKDOWN_EDITION
    ? drivers.filter((driver) => LOCKDOWN_SOURCE_CONTROL_KINDS.has(driver.kind))
    : drivers;
}

export const LOCKDOWN_PROVIDER_UPDATE_REFUSAL =
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

const OUTSIDE_ALLOWLIST = "Model is outside the configured Workers AI allowlist";

/** Every model-bearing adapter operation, including a model switch after the session opened. */
export function restrictAdapterModels(
  adapter: ProviderAdapterV2["Service"],
  allowed: ReadonlySet<string>,
): ProviderAdapterV2["Service"] {
  const check = (selection: ModelSelection | undefined) =>
    selection === undefined || allowed.has(selection.model)
      ? Effect.void
      : Effect.fail(
          new ProviderAdapterProtocolError({ driver: adapter.driver, detail: OUTSIDE_ALLOWLIST }),
        );
  const restrictRuntime = ({
    // Feedback uploads go to the provider's vendor, not the gateway.
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

/** Commit messages, PR text, branch names, titles and review guides use approved models only. */
export function restrictTextGenerationModels(
  service: ProviderTextGeneration,
  allowed: ReadonlySet<string>,
): ProviderTextGeneration {
  const guard =
    <Input extends { readonly modelSelection: ModelSelection }, A>(
      run: (input: Input) => Effect.Effect<A, TextGenerationError>,
    ) =>
    (input: Input) =>
      allowed.has(input.modelSelection.model)
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
  };
}

/**
 * OpenCode as the locked edition runs it: always its own local child process (never a server
 * URL), launched with the gateway-only configuration, and checked against the model allowlist on
 * every operation. Without a valid gateway configuration the instance is unavailable.
 */
export function lockdownOpenCodeDriver<Config extends { readonly serverUrl: string }, R, UsageR>(
  driver: ProviderDriver<Config, R, UsageR>,
): ProviderDriver<Config, R | never, UsageR> {
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
      const locked = yield* Effect.try({
        try: () => ({
          env: lockdownOpenCodeEnvironment(environment),
          models: lockdownAllowedModelSlugs(environment),
        }),
        catch: (cause) =>
          fail(cause instanceof Error ? cause.message : "Invalid Cloudflare configuration.", cause),
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
        orchestrationAdapter: restrictAdapterModels(instance.orchestrationAdapter, locked.models),
        textGeneration: restrictTextGenerationModels(instance.textGeneration, locked.models),
      } satisfies ProviderInstance;
    }),
  };
}
