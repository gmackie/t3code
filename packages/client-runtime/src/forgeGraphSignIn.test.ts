import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";

import { forgeGraphSignInFailure, forgeGraphSignInView } from "./forgeGraphSignIn.ts";

const waiting = {
  phase: "waiting" as const,
  server: "https://forgegraf.com",
  userCode: "ABCD-1234",
  verificationUrl: "https://forgegraf.com/device",
  expiresAt: null,
  account: null,
  message: null,
};

describe("forgeGraphSignInView", () => {
  it("offers sign-in, and never names the account, when nothing is signed in", () => {
    const view = forgeGraphSignInView({
      signedIn: false,
      host: null,
      savedInT3: false,
      state: null,
    });
    expect(view.summary).toMatch(/^Not signed in\./);
    expect(view).toMatchObject({
      pending: null,
      canCancel: false,
      canSignOut: false,
      signInLabel: "Sign in with ForgeGraph",
    });
  });

  it("shows the code to approve and only cancel while a sign-in waits", () => {
    const view = forgeGraphSignInView({
      signedIn: false,
      host: null,
      savedInT3: true,
      state: waiting,
    });
    expect(view.pending).toEqual({
      userCode: "ABCD-1234",
      verificationUrl: "https://forgegraf.com/device",
    });
    expect(view).toMatchObject({ canCancel: true, canSignOut: false, message: null });
  });

  it("says where the token comes from, and offers sign-out only for one T3 saved", () => {
    const fromCli = forgeGraphSignInView({
      signedIn: true,
      host: "forgegraf.com",
      savedInT3: false,
      state: null,
    });
    expect(fromCli.summary).toBe(
      "Signed in on forgegraf.com. The token comes from FG_API_TOKEN or the forge CLI.",
    );
    expect(fromCli.canSignOut).toBe(false);

    const saved = forgeGraphSignInView({
      signedIn: true,
      host: "forgegraf.com",
      savedInT3: true,
      state: { ...waiting, phase: "failed", message: "The code expired." },
    });
    expect(saved).toMatchObject({
      summary: "Signed in on forgegraf.com.",
      canSignOut: true,
      message: "The code expired.",
      signInLabel: "Sign in again",
    });
  });
});

describe("forgeGraphSignInFailure", () => {
  it("passes on the server's words, falls back when there are none, and ignores interruption", () => {
    expect(forgeGraphSignInFailure({ cause: Cause.fail(new Error("Denied.")) })).toBe("Denied.");
    expect(forgeGraphSignInFailure({ cause: Cause.fail("nope") })).toBe(
      "ForgeGraph did not answer. Try again.",
    );
    expect(forgeGraphSignInFailure({ cause: Cause.interrupt() })).toBeNull();
  });
});
