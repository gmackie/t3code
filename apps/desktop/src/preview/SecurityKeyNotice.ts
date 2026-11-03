export type SecurityKeyRequestPhase = "start" | "end";

// Credential Management Level 1 added `mediation` to creation requests too.
type ObservedOptions = {
  readonly publicKey?: unknown;
  readonly mediation?: CredentialMediationRequirement;
};

/**
 * Reports WebAuthn requests that Chromium serves itself, so the host can tell the
 * user to touch their security key. Electron draws no UI for them. Only installed
 * when the native passkey bridge is off; the bridge's system sheet is its own prompt.
 * Conditional requests are passkey autofill and stay pending for the page's life.
 */
export function installSecurityKeyNotice(report: (phase: SecurityKeyRequestPhase) => void) {
  if (typeof CredentialsContainer === "undefined") return;
  const container = CredentialsContainer.prototype;
  const nativeCreate = container.create;
  const nativeGet = container.get;
  const observe = (
    native: typeof nativeCreate | typeof nativeGet,
    self: CredentialsContainer,
    options: ObservedOptions | undefined,
  ) => {
    const request = Reflect.apply(native, self, [options]) as Promise<Credential | null>;
    if (!options?.publicKey || options.mediation === "conditional") return request;
    report("start");
    return request.finally(() => report("end"));
  };
  const define = (key: string, value: unknown) =>
    Object.defineProperty(container, key, { value, configurable: true, writable: true });

  define(
    "create",
    function create(this: CredentialsContainer, options?: CredentialCreationOptions) {
      return observe(nativeCreate, this, options);
    },
  );
  define("get", function get(this: CredentialsContainer, options?: CredentialRequestOptions) {
    return observe(nativeGet, this, options);
  });
}
