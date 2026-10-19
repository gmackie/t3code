/**
 * Signing an environment in to ForgeGraph with its device flow. The server runs the flow and keeps
 * the token in its secret store, so a remote or mobile client only shows the code and the link.
 *
 * @module contracts/forgeGraphSignIn
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ForgeGraphSignInState = Schema.Struct({
  /**
   * `waiting` until the code is approved in ForgeGraph; `succeeded` once the token is saved;
   * `failed` when the code expired, was denied, or ForgeGraph could not be reached.
   */
  phase: Schema.Literals(["idle", "waiting", "succeeded", "failed", "cancelled"]),
  /** The server being signed in to, which is the only one the saved token is sent to. */
  server: TrimmedNonEmptyString,
  userCode: Schema.NullOr(TrimmedNonEmptyString),
  verificationUrl: Schema.NullOr(TrimmedNonEmptyString),
  expiresAt: Schema.NullOr(IsoDateTime),
  /** The ForgeGraph user the saved token belongs to, once signed in. */
  account: Schema.NullOr(TrimmedNonEmptyString),
  message: Schema.NullOr(Schema.String),
});
export type ForgeGraphSignInState = typeof ForgeGraphSignInState.Type;

export class ForgeGraphSignInError extends Schema.TaggedError<ForgeGraphSignInError>()(
  "ForgeGraphSignInError",
  {
    operation: Schema.Literals(["start", "status", "cancel", "sign-out"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
