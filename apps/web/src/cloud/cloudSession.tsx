import { useAuth } from "@clerk/react";

import { retryClerkLoad, useClerkLoadFailed } from "../components/clerk/clerkLoadFailure";
import { useT3ConnectAuthPrompt } from "../components/clerk/useT3ConnectAuthPrompt";
import { useOidcSession } from "./NathanAuthShell";
import { isOidcCloudConfig } from "./publicConfig";

export interface CloudAuthState {
  readonly isLoaded: boolean;
  readonly isSignedIn: boolean | undefined;
  readonly userId: string | null | undefined;
  readonly getToken: (options?: unknown) => Promise<string | null>;
}

export interface CloudSignInActions {
  readonly loadFailed: boolean;
  readonly openAuthPrompt: () => void;
  readonly retrySignIn: () => void;
  readonly signOut: () => Promise<void>;
}

/**
 * Clerk and Nathan cannot share a provider. The flag is fixed at build time,
 * so a bundle calls exactly one of the two hooks.
 */
export function useCloudAuth(options?: {
  readonly treatPendingAsSignedOut?: boolean;
}): CloudAuthState {
  // oxlint-disable-next-line react/hooks -- isOidcCloudConfig() is fixed for the bundle, so only one branch runs.
  if (isOidcCloudConfig()) return useOidcAuth();
  // oxlint-disable-next-line react/hooks -- isOidcCloudConfig() is fixed for the bundle, so only one branch runs.
  return useClerkAuth(options);
}

export function useCloudSignIn(): CloudSignInActions {
  // oxlint-disable-next-line react/hooks -- isOidcCloudConfig() is fixed for the bundle, so only one branch runs.
  if (isOidcCloudConfig()) return useOidcSignIn();
  // oxlint-disable-next-line react/hooks -- isOidcCloudConfig() is fixed for the bundle, so only one branch runs.
  return useClerkSignIn();
}

function useOidcAuth(): CloudAuthState {
  const session = useOidcSession();
  return {
    isLoaded: session.isLoaded,
    isSignedIn: session.isSignedIn,
    userId: session.userId,
    getToken: () => session.getToken(),
  };
}

function useOidcSignIn(): CloudSignInActions {
  const session = useOidcSession();
  return {
    loadFailed: session.loadFailed,
    openAuthPrompt: session.openAuthPrompt,
    retrySignIn: session.retrySignIn,
    signOut: async () => session.signOut(),
  };
}

function useClerkAuth(options?: { readonly treatPendingAsSignedOut?: boolean }): CloudAuthState {
  const auth = useAuth(options);
  return {
    isLoaded: auth.isLoaded,
    isSignedIn: auth.isSignedIn,
    userId: auth.userId,
    getToken: async (tokenOptions) => (await auth.getToken(tokenOptions as never)) ?? null,
  };
}

function useClerkSignIn(): CloudSignInActions {
  const auth = useAuth();
  const loadFailed = useClerkLoadFailed();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  return {
    loadFailed,
    openAuthPrompt,
    retrySignIn: retryClerkLoad,
    signOut: () => auth.signOut({ redirectUrl: window.location.href }),
  };
}
