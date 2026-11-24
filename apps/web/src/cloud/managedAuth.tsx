import { useClerk } from "@clerk/react";
import { createCloudAccountService } from "@t3tools/client-runtime/relay";
import { useEffect, type ReactNode } from "react";

import { resolveRelayClerkTokenOptions } from "./publicConfig";
import {
  activateManagedRelayAuthentication,
  cleanUpManagedRelayAccount,
  deactivateManagedRelayAuthentication,
} from "./managedRelayAuth";

export { activateManagedRelayAuthentication, deactivateManagedRelayAuthentication };

type ClerkInstance = ReturnType<typeof useClerk>;

function clerkTokenReader(clerk: ClerkInstance): () => Promise<string | null> {
  return async () =>
    clerk.session ? await clerk.session.getToken(resolveRelayClerkTokenOptions()) : null;
}

const managedRelayAccountService = createCloudAccountService<ClerkInstance>({
  deactivate: deactivateManagedRelayAuthentication,
  detach: deactivateManagedRelayAuthentication,
  cleanUp: cleanUpManagedRelayAccount,
  activate: ({ source, accountId }) =>
    activateManagedRelayAuthentication(accountId, clerkTokenReader(source)),
});

export function ManagedRelayAuthProvider({ children }: { readonly children: ReactNode }) {
  // ClerkProvider creates the Clerk instance and owns its lifetime, so the
  // account service observes it for as long as this provider is mounted.
  const clerk = useClerk();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- attaches the Clerk instance to the managed relay account service for the provider's lifetime
  useEffect(() => managedRelayAccountService.attach(clerk), [clerk]);
  return children;
}
