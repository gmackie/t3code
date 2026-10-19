/**
 * What every client shows while an environment signs in to ForgeGraph. The server runs the device
 * flow and keeps the token, so web, mobile and the command palette only describe where it stands
 * and which buttons apply; each draws that in its own components.
 *
 * @module client-runtime/forgeGraphSignIn
 */
import type { ForgeGraphSignInState } from "@t3tools/contracts";
import * as Cause from "effect/Cause";

import { squashAtomCommandFailure } from "./state/runtime.ts";

/** How often a waiting sign-in asks the server whether the code was approved. */
export const FORGEGRAPH_SIGN_IN_STATUS_INTERVAL_MS = 3_000;

export interface ForgeGraphSignInViewInput {
  /** Discovery says the environment is signed in, by whichever source. */
  readonly signedIn: boolean;
  /** The ForgeGraph host discovery reports, when it reports one. */
  readonly host: string | null;
  /** A token saved through T3 Code, which is the only one sign-out can remove. */
  readonly savedInT3: boolean;
  /** The last state the server reported for this environment's sign-in, if any. */
  readonly state: ForgeGraphSignInState | null;
}

export interface ForgeGraphSignInView {
  /** One line on whether the environment is signed in. The account is never named here. */
  readonly summary: string;
  /** Present while a code waits for approval in ForgeGraph. */
  readonly pending: { readonly userCode: string; readonly verificationUrl: string } | null;
  /** What the server last said about a finished attempt, such as why it failed. */
  readonly message: string | null;
  readonly canCancel: boolean;
  readonly canSignOut: boolean;
  readonly signInLabel: "Sign in with ForgeGraph" | "Sign in again";
}

export function forgeGraphSignInView(input: ForgeGraphSignInViewInput): ForgeGraphSignInView {
  const waiting = input.state?.phase === "waiting";
  const pending =
    waiting && input.state?.userCode && input.state.verificationUrl
      ? { userCode: input.state.userCode, verificationUrl: input.state.verificationUrl }
      : null;
  const summary = input.signedIn
    ? `Signed in${input.host ? ` on ${input.host}` : ""}.${
        input.savedInT3 ? "" : " The token comes from FG_API_TOKEN or the forge CLI."
      }`
    : "Not signed in. Sign in here, or set FG_API_TOKEN or run `forge login` on the server.";
  return {
    summary,
    pending,
    message: waiting ? null : (input.state?.message ?? null),
    canCancel: waiting,
    canSignOut: !waiting && input.savedInT3,
    signInLabel: input.savedInT3 ? "Sign in again" : "Sign in with ForgeGraph",
  };
}

/**
 * What a failed sign-in command says to the person who pressed it. Null when it was interrupted,
 * which is the client going away rather than ForgeGraph refusing.
 */
export function forgeGraphSignInFailure(result: {
  readonly cause: Cause.Cause<unknown>;
}): string | null {
  if (Cause.hasInterruptsOnly(result.cause)) return null;
  const failure = squashAtomCommandFailure(result);
  return failure instanceof Error && failure.message.trim().length > 0
    ? failure.message
    : "ForgeGraph did not answer. Try again.";
}
