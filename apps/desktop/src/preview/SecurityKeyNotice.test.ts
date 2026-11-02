import { assert, describe, it } from "@effect/vitest";
import { afterEach, vi } from "vite-plus/test";

import { installSecurityKeyNotice, type SecurityKeyRequestPhase } from "./SecurityKeyNotice.ts";

const install = () => {
  let settle: { resolve: (value: unknown) => void; reject: (error: unknown) => void } | undefined;
  const nativeGet = vi.fn(
    (_options?: unknown) =>
      new Promise((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );
  const nativeCreate = vi.fn(async (_options?: unknown) => created);
  class FakeCredentialsContainer {
    create(options?: unknown) {
      return nativeCreate(options);
    }
    get(options?: unknown) {
      return nativeGet(options);
    }
  }
  vi.stubGlobal("CredentialsContainer", FakeCredentialsContainer);
  const phases: Array<SecurityKeyRequestPhase> = [];
  installSecurityKeyNotice((phase) => phases.push(phase));
  return {
    credentials: new FakeCredentialsContainer() as unknown as CredentialsContainer,
    phases,
    nativeGet,
    settle: () => settle!,
  };
};

const publicKey = { challenge: new Uint8Array([1]) };
const created = { id: "created" } as Credential;
const assertion = { id: "assertion" } as Credential;

describe("installSecurityKeyNotice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a security-key request until it settles, passing the page's options through", async () => {
    const { credentials, phases, nativeGet, settle } = install();
    const options = { publicKey, signal: new AbortController().signal };

    const request = credentials.get(options);
    assert.deepStrictEqual(phases, ["start"]);
    assert.strictEqual(nativeGet.mock.calls[0]?.[0], options);

    settle().resolve(assertion);
    assert.strictEqual(await request, assertion);
    assert.deepStrictEqual(phases, ["start", "end"]);
  });

  it("reports the end when the request fails, and keeps the page's error", async () => {
    const { credentials, phases, settle } = install();
    const request = credentials.get({ publicKey });
    const error = new DOMException("cancelled", "NotAllowedError");

    settle().reject(error);
    const thrown = await request.then(
      () => undefined,
      (cause: unknown) => cause,
    );
    assert.strictEqual(thrown, error);
    assert.deepStrictEqual(phases, ["start", "end"]);
  });

  it("ignores passkey autofill and non-WebAuthn credential requests", async () => {
    const { credentials, phases } = install();

    void credentials.get({ publicKey, mediation: "conditional" });
    void credentials.get({ password: true } as CredentialRequestOptions);
    await credentials.create({ password: { id: "a", password: "b" } } as CredentialCreationOptions);
    assert.deepStrictEqual(phases, []);

    assert.strictEqual(
      await credentials.create({ publicKey } as unknown as CredentialCreationOptions),
      created,
    );
    assert.deepStrictEqual(phases, ["start", "end"]);
  });
});
