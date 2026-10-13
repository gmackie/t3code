import { ManagedRelay } from "@t3tools/client-runtime/relay";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const denied = (action: ManagedRelay.ManagedRelayRequestAction) =>
  Effect.fail(
    new ManagedRelay.ManagedRelayRequestFailedError({
      action,
      cause: "Remote connections are disabled in this edition.",
    }),
  );

const disabledSigner = Layer.succeed(ManagedRelay.ManagedRelayDpopSigner, {
  thumbprint: Effect.fail(
    new ManagedRelay.ManagedRelayDpopKeyLoadError({
      keyStore: "indexed-db",
      cause: "Remote connections disabled.",
    }),
  ),
  createProof: (input) =>
    Effect.fail(
      new ManagedRelay.ManagedRelayDpopProofCreationError({
        method: input.method,
        url: input.url,
        cause: "Remote connections disabled.",
      }),
    ),
});

export const managedRelayClientLayer = (_relayUrl: string) =>
  Layer.merge(
    disabledSigner,
    Layer.succeed(ManagedRelay.ManagedRelayClient, {
      relayUrl: "",
      listEnvironments: () => Effect.succeed([]),
      listDevices: () => Effect.succeed([]),
      createEnvironmentLinkChallenge: () => denied("create relay environment link challenge"),
      linkEnvironment: () => denied("link relay environment"),
      unlinkEnvironment: () => denied("unlink relay environment"),
      getEnvironmentStatus: () => denied("get relay environment status"),
      connectEnvironment: () => denied("connect relay environment"),
      registerDevice: () => denied("register relay mobile device"),
      unregisterDevice: () => denied("unregister relay mobile device"),
      registerLiveActivity: () => denied("register relay live activity"),
      getAgentActivitySnapshot: () => denied("read relay agent activity snapshot"),
      resetTokenCache: Effect.void,
    }),
  );
