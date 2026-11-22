import { ProviderDriverKind, type ManagedPolicyDocument } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  guardFetch,
  isLockdownEgressAllowed,
  isLockdownModelAllowed,
  LOCKDOWN_EDITION,
  lockdownAllowedHosts,
  lockdownDispatchInterceptor,
  lockdownOpenCodeEnvironment,
  lockdownOpenCodeProviders,
  lockdownPolicyDocument,
  withLockdownPolicy,
} from "./lockdownEdition.ts";
import * as OtelEnvironment from "./otelEnvironment.ts";

// Hosts T3 Code reaches upstream: analytics, model manifests, npm, release feeds, Clerk, relay,
// vendor APIs, theme search, OTLP collectors.
const BLOCKED = [
  "https://ingest.t3.codes/batch/",
  "https://us.i.posthog.com/batch/",
  "https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json",
  "https://registry.npmjs.org/opencode-ai/latest",
  "https://api.github.com/repos/pingdotgg/t3code/releases/latest",
  "https://clerk.t3.codes/v1/client",
  "wss://relay.t3.codes/socket",
  "https://api.anthropic.com/api/oauth/usage",
  "https://chatgpt.com/backend-api/wham/usage",
  "https://opencode.ai/zen/go/v1/usage",
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json",
  "https://open-vsx.org/api/-/search",
  "https://collector.example.com/v1/traces",
  "http://169.254.169.254/latest/meta-data",
  "http://192.168.1.10:3773/",
  // An approved host over plain http is still refused.
  "http://gitlab.example.com/api/v4/projects",
];

describe("lockdown edition", () => {
  it("is on in this branch", () => {
    expect(LOCKDOWN_EDITION).toBe(true);
  });

  it("floors an unmanaged machine to local-only, OpenCode-only, no telemetry, Connect or updates", () => {
    const document = lockdownPolicyDocument(undefined);
    expect(document.organization).toBe("T3 Code Locked");
    expect(document.limits).toEqual({
      clients: ["desktop", "local-browser"],
      connect: false,
      webhookTasks: false,
      telemetry: false,
      browserCookieImport: false,
      previewTunnel: false,
      providers: { allowedDrivers: ["opencode"] },
      updates: { mode: "off" },
    });
    expect(document.settings?.enableProviderUpdateChecks).toEqual({ value: false, locked: true });
    expect(document.settings?.linkedEnvironmentsEnabled).toEqual({ value: false, locked: true });
    expect(document.settings?.guestSharingEnabled).toEqual({ value: false, locked: true });
  });

  it("lets an administrator's policy narrow the floor but never widen it", () => {
    const admin: ManagedPolicyDocument = {
      schemaVersion: 1,
      organization: "Example Corp",
      supportUrl: "https://help.example.com",
      settings: {
        enableProviderUpdateChecks: { value: true, locked: true },
        branchNamePrefix: { value: "corp", locked: true },
      },
      limits: {
        maxRuntimeMode: "approval-required",
        clients: ["remote", "desktop"],
        connect: true,
        telemetry: true,
        webhookTasks: true,
        browserCookieImport: true,
        providers: { allowedDrivers: [ProviderDriverKind.make("codex")] },
        updates: { mode: "auto", feedUrl: "https://updates.example.com" },
      },
    };
    const document = lockdownPolicyDocument(admin);
    expect(document.organization).toBe("Example Corp");
    expect(document.supportUrl).toBe("https://help.example.com");
    expect(document.settings?.branchNamePrefix).toEqual({ value: "corp", locked: true });
    expect(document.settings?.enableProviderUpdateChecks).toEqual({ value: false, locked: true });
    expect(document.limits).toEqual({
      maxRuntimeMode: "approval-required",
      clients: ["desktop"],
      connect: false,
      webhookTasks: false,
      telemetry: false,
      browserCookieImport: false,
      previewTunnel: false,
      providers: { allowedDrivers: ["opencode"] },
      updates: { mode: "off" },
    });
    expect(withLockdownPolicy(undefined, "/etc/t3code/policy.json").source).toBe(
      "/etc/t3code/policy.json",
    );
  });

  it("runs OpenCode with only its signed-in providers, and no updater, model fetch or sharing", () => {
    const providers = lockdownOpenCodeProviders(
      JSON.stringify({ openai: { type: "oauth" }, anthropic: { type: "api", key: "k" } }),
    );
    expect(providers).toEqual(["openai", "anthropic"]);
    const env = lockdownOpenCodeEnvironment(
      {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          enabled_providers: ["google"],
          provider: { openai: { options: { baseURL: "https://elsewhere.example" } } },
          model: "openai/gpt-5",
          small_model: "google/gemini-flash",
          keep: 1,
        }),
      },
      providers,
    );
    expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe("true");
    expect(env.OPENCODE_DISABLE_MODELS_FETCH).toBe("true");
    expect(env.OPENCODE_DISABLE_SHARE).toBe("true");
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!);
    expect(config.enabled_providers).toEqual(["openai", "anthropic"]);
    expect(config.share).toBe("disabled");
    expect(config.autoupdate).toBe(false);
    expect(config.keep).toBe(1);
    expect(config.provider).toBeUndefined();
    expect(config.model).toBe("openai/gpt-5");
    expect(config.small_model).toBeUndefined();
    expect(isLockdownModelAllowed("openai/gpt-5", providers)).toBe(true);
    expect(isLockdownModelAllowed("google/gemini-flash", providers)).toBe(false);
    expect(isLockdownModelAllowed("openai", providers)).toBe(false);
  });

  it("keeps OpenCode unavailable until a provider is signed in", () => {
    expect(() => lockdownOpenCodeProviders("{}")).toThrow(/opencode auth login/);
    expect(() => lockdownOpenCodeProviders("[]")).toThrow(/opencode auth login/);
    expect(() => lockdownOpenCodeProviders("not json")).toThrow(/not valid JSON/);
  });

  it("allows only loopback and approved https hosts", () => {
    const allowed = lockdownAllowedHosts({
      T3CODE_LOCKDOWN_ALLOWED_HOSTS: " GitLab.Example.com ,",
    });
    for (const url of BLOCKED) expect(isLockdownEgressAllowed(url, allowed), url).toBe(false);
    for (const url of [
      "http://127.0.0.1:4096/session",
      "http://localhost:3773/api",
      "ws://[::1]:3773/ws",
      "https://gitlab.example.com/api/v4/projects",
      "data:text/plain,hi",
    ]) {
      expect(isLockdownEgressAllowed(url, allowed), url).toBe(true);
    }
  });

  it("rejects a blocked fetch before it reaches the network", async () => {
    const reached: Array<string> = [];
    const fetchImpl = guardFetch(async (input) => {
      reached.push(String(input));
      return new Response("ok");
    }, new Set());
    for (const url of BLOCKED) {
      await expect(fetchImpl(url)).rejects.toMatchObject({ _tag: "LockdownEgressBlockedError" });
      await expect(fetchImpl(new Request(url))).rejects.toMatchObject({
        _tag: "LockdownEgressBlockedError",
      });
    }
    expect(reached).toEqual([]);
    await expect(fetchImpl("http://127.0.0.1:1/ok")).resolves.toBeInstanceOf(Response);
    expect(reached).toEqual(["http://127.0.0.1:1/ok"]);
    expect(guardFetch(fetchImpl, new Set())).toBe(fetchImpl);
  });

  it("refuses blocked origins in the undici dispatcher too", () => {
    const dispatched: Array<string> = [];
    const dispatch = lockdownDispatchInterceptor(new Set(["gitlab.example.com"]))((
      options: { readonly origin?: string },
      _handler: unknown,
    ) => {
      dispatched.push(options.origin ?? "");
      return true;
    });
    expect(() => dispatch({ origin: "https://us.i.posthog.com" }, {})).toThrow(
      /T3 Code Locked blocked a request to https:\/\/us\.i\.posthog\.com/,
    );
    expect(() => dispatch({}, {})).toThrow(/blocked/);
    expect(dispatch({ origin: "http://127.0.0.1:4096" }, {})).toBe(true);
    expect(dispatch({ origin: "https://gitlab.example.com" }, {})).toBe(true);
    expect(dispatched).toEqual(["http://127.0.0.1:4096", "https://gitlab.example.com"]);
  });

  it("exports no OTLP telemetry and no relay traces, whatever configured it", () => {
    const configured = OtelEnvironment.resolveSignalEndpoint(
      OtelEnvironment.none,
      "traces",
      {
        url: "https://collector.example.com/v1/traces",
        export: { protocol: "http/protobuf", headers: {}, exportIntervalMs: 1000 },
      },
      {
        bootstrapUrl: "https://collector.example.com",
        settingsUrl: "https://collector.example.com",
      },
    );
    expect(configured).toBeUndefined();
    expect(
      OtelEnvironment.isRelayTracingEnabled({
        T3CODE_TELEMETRY_ENABLED: "true",
        T3CODE_OTEL_SDK_DISABLED: "false",
      }),
    ).toBe(false);
  });
});
