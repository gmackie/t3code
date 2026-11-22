/**
 * T3 Code Locked (T3CODE-15, T3CODE-110): local OpenCode with the providers signed in to through
 * OpenCode's auth file, plus GitLab, nothing else. Upstream files stay; `LOCKDOWN_EDITION` guards a few choke
 * points so daily merges of main stay small. Nothing a user can change at runtime turns it off.
 */
import {
  type ManagedPolicyClient,
  type ManagedPolicyDocument,
  type ManagedPolicySetting,
  ProviderDriverKind,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** The switch. This branch is the locked edition; main does not carry this file. */
export const LOCKDOWN_EDITION: boolean = true;

type Env = Readonly<Record<string, string | undefined>>;

/** Shown as "Managed by T3 Code Locked" when no administrator policy names an organization. */
const LOCKDOWN_ORGANIZATION = "T3 Code Locked";

/**
 * A separate application identity, so the locked app never shares a profile, data directory,
 * protocol handler or saved connections with a standard T3 Code install. The names match the
 * October 2026 build so existing installs keep their data.
 */
export const LOCKDOWN_IDENTITY = {
  appId: "com.t3tools.t3code.locked",
  productName: "T3 Code Locked",
  artifactPrefix: "T3-Code-Locked",
  baseDirName: ".t3-locked",
  userDataDirName: "t3code-locked",
  devUserDataDirName: "t3code-locked-dev",
  scheme: "t3code-locked",
  devScheme: "t3code-locked-dev",
} as const;

const LOCKDOWN_OPENCODE_DRIVER = ProviderDriverKind.make("opencode");

/** Clients the locked server accepts: nothing off this machine. */
const LOCKDOWN_CLIENTS: ReadonlyArray<ManagedPolicyClient> = ["desktop", "local-browser"];

export class LockdownConfigurationError extends Schema.TaggedError<LockdownConfigurationError>()(
  "LockdownConfigurationError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

const configurationError = (detail: string) => new LockdownConfigurationError({ detail });

/**
 * The providers signed in to with `opencode auth login`: the keys of OpenCode's auth file. They
 * are the only providers the locked OpenCode enables, so environment keys and config-defined
 * providers stay off. Throws when there are none, which keeps OpenCode unavailable.
 */
export function lockdownOpenCodeProviders(authFile: string): ReadonlyArray<string> {
  let auth: unknown;
  try {
    auth = JSON.parse(authFile);
  } catch {
    throw configurationError("OpenCode's auth file is not valid JSON.");
  }
  const providers =
    typeof auth === "object" && auth !== null && !Array.isArray(auth) ? Object.keys(auth) : [];
  if (providers.length === 0) {
    throw configurationError("Sign in to a provider with `opencode auth login` to use OpenCode.");
  }
  return providers;
}

/** Whether a T3 OpenCode model slug (`<provider>/<model>`) belongs to a signed-in provider. */
export function isLockdownModelAllowed(model: string, providers: ReadonlyArray<string>): boolean {
  const slash = model.indexOf("/");
  return slash > 0 && providers.includes(model.slice(0, slash));
}

/**
 * The environment OpenCode runs with: no auto-update, no models.dev fetch, no sharing, and only
 * the signed-in providers enabled, using OpenCode's own definitions for them.
 */
export function lockdownOpenCodeEnvironment(
  env: Env,
  providers: ReadonlyArray<string>,
): Record<string, string> {
  let existing: unknown;
  try {
    existing = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? "{}");
  } catch {
    throw configurationError("OPENCODE_CONFIG_CONTENT is not valid JSON.");
  }
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
    throw configurationError("OPENCODE_CONFIG_CONTENT must contain an object.");
  }
  // Custom provider entries could point a signed-in provider at another endpoint.
  const { provider: _provider, model, small_model, ...rest } = existing as Record<string, unknown>;
  const keep = (value: unknown) =>
    typeof value === "string" && isLockdownModelAllowed(value, providers) ? value : undefined;
  return {
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    OPENCODE_DISABLE_SHARE: "true",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...rest,
      ...(keep(model) === undefined ? {} : { model }),
      ...(keep(small_model) === undefined ? {} : { small_model }),
      autoupdate: false,
      share: "disabled",
      enabled_providers: [...providers],
      disabled_providers: [],
    }),
  };
}

/** Settings the locked edition sets and locks. Keys are dot paths into `ServerSettings`. */
function lockdownSettings(): Record<string, ManagedPolicySetting> {
  const locked = (value: unknown): ManagedPolicySetting => ({ value, locked: true });
  return {
    // npm "latest version" lookups and the remote model manifest.
    enableProviderUpdateChecks: locked(false),
    // Remote T3 servers and guest links reach other machines.
    linkedEnvironmentsEnabled: locked(false),
    guestSharingEnabled: locked(false),
    // No observability.* entries: a policy cannot set them (each user's environment resolves them
    // at startup), so OTLP export is switched off in otelEnvironment.ts instead.
  };
}

const overlaps = (a: string, b: string) =>
  a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

/**
 * The policy every locked process enforces. An administrator's policy can only narrow it: its
 * organization, support link, runtime-mode ceiling and other settings are kept, but whatever it
 * says about clients, Connect, telemetry, webhooks, cookie import, providers or updates is
 * replaced by the locked floor.
 */
export function lockdownPolicyDocument(
  admin: ManagedPolicyDocument | undefined,
): ManagedPolicyDocument {
  const settings = lockdownSettings();
  const adminSettings = Object.fromEntries(
    Object.entries(admin?.settings ?? {}).filter(
      ([path]) => !Object.keys(settings).some((lockedPath) => overlaps(path, lockedPath)),
    ),
  );
  const adminClients = (admin?.limits?.clients ?? []).filter((client) =>
    LOCKDOWN_CLIENTS.includes(client),
  );
  const [firstClient, ...otherClients] =
    adminClients.length > 0 ? adminClients : [...LOCKDOWN_CLIENTS];
  const maxRuntimeMode = admin?.limits?.maxRuntimeMode;
  const instances = admin?.limits?.providers?.instances;
  return {
    schemaVersion: 1,
    organization: admin?.organization ?? LOCKDOWN_ORGANIZATION,
    ...(admin?.supportUrl === undefined ? {} : { supportUrl: admin.supportUrl }),
    settings: { ...adminSettings, ...settings },
    limits: {
      ...(maxRuntimeMode === undefined ? {} : { maxRuntimeMode }),
      clients: [firstClient!, ...otherClients],
      connect: false,
      webhookTasks: false,
      telemetry: false,
      browserCookieImport: false,
      // Opening this machine's local servers to other devices.
      previewTunnel: false,
      providers: {
        allowedDrivers: [LOCKDOWN_OPENCODE_DRIVER],
        ...(instances === undefined ? {} : { instances }),
      },
      updates: { mode: "off" },
    },
  };
}

/** The managed-policy lookup result shape shared by the server and the desktop app. */
export interface FoundManagedPolicy {
  readonly source: string;
  readonly document: ManagedPolicyDocument;
}

/** Apply the locked floor to whatever policy (or none) the machine has. */
export function withLockdownPolicy(
  found: FoundManagedPolicy | undefined,
  fallbackSource: string,
): FoundManagedPolicy {
  return {
    source: found?.source ?? fallbackSource,
    document: lockdownPolicyDocument(found?.document),
  };
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "::1", "[::1]"]);

const isLoopbackHostname = (hostname: string) => {
  const host = hostname.toLowerCase();
  return (
    LOOPBACK_HOSTNAMES.has(host) ||
    host.endsWith(".localhost") ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
};

/**
 * Hosts beyond loopback that in-process requests may reach: the administrator's GitLab and
 * anything else it approved, from `T3CODE_LOCKDOWN_ALLOWED_HOSTS` (comma separated host names).
 * Only https is allowed to them.
 */
export function lockdownAllowedHosts(env: Env): ReadonlySet<string> {
  return new Set(
    (env.T3CODE_LOCKDOWN_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  );
}

/** Whether an in-process request to `target` may leave this process. */
export function isLockdownEgressAllowed(
  target: string | URL,
  allowedHosts: ReadonlySet<string>,
): boolean {
  let url: URL;
  try {
    url = typeof target === "string" ? new URL(target) : target;
  } catch {
    return false;
  }
  const protocol = url.protocol;
  if (isLoopbackHostname(url.hostname)) {
    return (
      protocol === "http:" || protocol === "https:" || protocol === "ws:" || protocol === "wss:"
    );
  }
  if (protocol === "data:" || protocol === "blob:") return true;
  return (
    (protocol === "https:" || protocol === "wss:") && allowedHosts.has(url.hostname.toLowerCase())
  );
}

export class LockdownEgressBlockedError extends Schema.TaggedError<LockdownEgressBlockedError>()(
  "LockdownEgressBlockedError",
  { target: Schema.String },
) {
  override get message(): string {
    return `T3 Code Locked blocked a request to ${this.target}: only this machine and approved hosts are reachable.`;
  }
}

const describeTarget = (target: string) => {
  try {
    const url = new URL(target);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "an unparseable URL";
  }
};

type FetchInput = Parameters<typeof fetch>[0];
type FetchLike = (input: FetchInput, init?: RequestInit) => Promise<Response>;
const GUARDED = Symbol.for("t3code.lockdown.fetchGuard");

/** The URL a fetch call targets. */
const fetchTarget = (input: FetchInput): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** Wrap `fetch` so a request to anything but loopback or an approved host rejects first. */
export function guardFetch(fetchImpl: FetchLike, allowedHosts: ReadonlySet<string>): FetchLike {
  if ((fetchImpl as { [GUARDED]?: true })[GUARDED]) return fetchImpl;
  const guarded: FetchLike = (input, init) => {
    const target = fetchTarget(input);
    return isLockdownEgressAllowed(target, allowedHosts)
      ? fetchImpl(input, init)
      : Promise.reject(new LockdownEgressBlockedError({ target: describeTarget(target) }));
  };
  Object.defineProperty(guarded, GUARDED, { value: true });
  return guarded;
}

/** Replace `target.fetch` (usually `globalThis`) with the guarded one. Idempotent. */
export function installLockdownFetchGuard(target: { fetch: FetchLike }, env: Env): void {
  if (!LOCKDOWN_EDITION) return;
  target.fetch = guardFetch(target.fetch, lockdownAllowedHosts(env));
}

/** An undici-style dispatch interceptor with the same rule, for clients that bypass `fetch`. */
export function lockdownDispatchInterceptor(allowedHosts: ReadonlySet<string>) {
  return <
    Options extends { readonly origin?: string | URL | null; readonly path?: string },
    Handler,
    Result,
  >(
    dispatch: (options: Options, handler: Handler) => Result,
  ) =>
    (options: Options, handler: Handler): Result => {
      const origin =
        options.origin === undefined || options.origin === null ? "" : String(options.origin);
      if (!isLockdownEgressAllowed(origin, allowedHosts)) {
        throw new LockdownEgressBlockedError({ target: describeTarget(origin) });
      }
      return dispatch(options, handler);
    };
}
