import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as Effect from "effect/Effect";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Persistence from "../platform/persistence.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";
import { invalidateCachedVcsRefs } from "./vcsRefInvalidation.ts";

export function createSourceControlEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Persistence.EnvironmentCacheStore | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  return {
    discovery: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:server:source-control-discovery",
      tag: WS_METHODS.serverDiscoverSourceControl,
    }),
    appAccess: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:source-control:app-access",
      tag: WS_METHODS.sourceControlAppAccess,
    }),
    // One check, as after cloning, where no view keeps the query mounted.
    checkAppAccess: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:check-app-access",
      tag: WS_METHODS.sourceControlAppAccess,
    }),
    repository: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:source-control:repository",
      tag: WS_METHODS.sourceControlLookupRepository,
    }),
    // Clone-backed project creation. The RPC returns once the project exists
    // and the clone runs in the background; `projectClones` carries progress.
    startProjectClone: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:project-clone-start",
      tag: WS_METHODS.projectCloneStart,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }) => environmentId,
      },
    }),
    // Cancel and retry share the start queue so a double click cannot race
    // two actions against the same clone.
    cancelProjectClone: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:project-clone-cancel",
      tag: WS_METHODS.projectCloneCancel,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }) => environmentId,
      },
    }),
    retryProjectClone: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:project-clone-retry",
      tag: WS_METHODS.projectCloneRetry,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }) => environmentId,
      },
    }),
    // Unscheduled: a pending sign-in waits on the user for minutes and must not hold up clones.
    startSignIn: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:sign-in-start",
      tag: WS_METHODS.sourceControlSignInStart,
    }),
    waitForSignIn: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:sign-in-wait",
      tag: WS_METHODS.sourceControlSignInWait,
    }),
    cancelSignIn: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:sign-in-cancel",
      tag: WS_METHODS.sourceControlSignInCancel,
    }),
    projectClones: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:source-control:project-clones",
      tag: WS_METHODS.subscribeProjectClones,
    }),
    // ForgeGraph's device flow runs on the server; these start it, read where it stands, stop it,
    // and forget the saved token. One queue per environment, so a double click cannot race them.
    ...forgeGraphSignInCommands(runtime),
    publishRepository: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:publish-repository",
      tag: WS_METHODS.sourceControlPublishRepository,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
      onSettled: (target, registry) =>
        invalidateCachedVcsRefs(registry, {
          environmentId: target.environmentId,
          cwd: target.input.cwd,
        }),
    }),
  };
}

function forgeGraphSignInCommands<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Persistence.EnvironmentCacheStore | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const forgeGraphSignInStatus = createEnvironmentRpcCommand(runtime, {
    label: "environment-data:source-control:forgegraph-sign-in-status",
    tag: WS_METHODS.sourceControlForgeGraphSignInStatus,
  });
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };
  return {
    forgeGraphSignInStart: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:forgegraph-sign-in-start",
      tag: WS_METHODS.sourceControlForgeGraphSignInStart,
      scheduler,
      concurrency,
    }),
    forgeGraphSignInStatus,
    forgeGraphSignInState: createEnvironmentQueryAtomFamily(runtime, {
      label: "environment-data:source-control:forgegraph-sign-in-state",
      staleTimeMs: 0,
      execute: Effect.fn("sourceControl.forgeGraphSignInState")(function* () {
        const registry = yield* AtomRegistry.AtomRegistry;
        const supervisor = yield* EnvironmentSupervisor;
        const result = yield* Effect.promise(() =>
          forgeGraphSignInStatus.run(registry, {
            environmentId: supervisor.target.environmentId,
            input: {},
          }),
        );
        if (result._tag === "Failure") return yield* Effect.failCause(result.cause);
        return result.value;
      }),
    }),
    forgeGraphSignInCancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:forgegraph-sign-in-cancel",
      tag: WS_METHODS.sourceControlForgeGraphSignInCancel,
      scheduler,
      concurrency,
    }),
    forgeGraphSignOut: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:source-control:forgegraph-sign-out",
      tag: WS_METHODS.sourceControlForgeGraphSignOut,
      scheduler,
      concurrency,
    }),
  };
}
