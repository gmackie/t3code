/**
 * lockdownDesktop - the desktop side of T3 Code Locked (see `@t3tools/shared/lockdownEdition`).
 *
 * @module lockdownDesktop
 */
import { isLockdownEgressAllowed, lockdownAllowedHosts } from "@t3tools/shared/lockdownEdition";
import { SshInvalidTargetError, SshLaunchError } from "@t3tools/ssh/errors";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as AppleSpeech from "../speech/AppleSpeech.ts";
import * as DesktopSshEnvironment from "../ssh/DesktopSshEnvironment.ts";

const LOOPBACK_HTTP = "http://127.0.0.1:* http://localhost:* http://[::1]:*";
const LOOPBACK_WS = "ws://127.0.0.1:* ws://localhost:* ws://[::1]:*";

/**
 * The renderer may load only the app bundle and talk only to servers on this machine. No Clerk,
 * no Cloudflare challenge script, no remote images (agent markdown, avatars, registry icons), no
 * theme search, no remote environments.
 */
export function lockdownContentSecurityPolicy(scheme: string): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    `connect-src 'self' blob: ${LOOPBACK_HTTP} ${LOOPBACK_WS}`,
    `img-src 'self' ${scheme}: blob: data: ${LOOPBACK_HTTP}`,
    `media-src 'self' ${scheme}: blob: ${LOOPBACK_HTTP}`,
    "style-src 'self' 'unsafe-inline'",
    `font-src 'self' ${scheme}: data:`,
    "worker-src 'self' blob:",
    `frame-src 'self' blob: ${LOOPBACK_HTTP}`,
    `object-src 'self' blob: ${LOOPBACK_HTTP}`,
    "form-action 'self'",
  ].join("; ");
}

const NETWORK_URLS = ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"];

type RequestFilterSession = {
  readonly webRequest: {
    onBeforeRequest(
      filter: { urls: Array<string> },
      listener: (
        details: { readonly url: string },
        callback: (response: { cancel: boolean }) => void,
      ) => void,
    ): void;
  };
};

/**
 * Chromium's own requests from the default session (the app window, `net.fetch` and
 * `session.fetch`) follow the in-process egress rule too; the fetch guard never sees them.
 * Preview browser sessions use their own partitions: browser automation stays enabled.
 */
export function installSessionEgressGuard(
  session: RequestFilterSession,
  env: Readonly<Record<string, string | undefined>>,
): void {
  const allowedHosts = lockdownAllowedHosts(env);
  session.webRequest.onBeforeRequest({ urls: NETWORK_URLS }, (details, callback) =>
    callback({ cancel: !isLockdownEgressAllowed(details.url, allowedHosts) }),
  );
}

const SSH_DISABLED = "Remote SSH environments are disabled in T3 Code Locked.";

/** SSH environments start a T3 server on another machine; the locked app never does. */
const sshEnvironmentDisabled: DesktopSshEnvironment.DesktopSshEnvironment["Service"] = {
  discoverHosts: () => Effect.succeed([]),
  resolveHost: () => Effect.fail(new SshInvalidTargetError({ message: SSH_DISABLED })),
  ensureEnvironment: () => Effect.fail(new SshLaunchError({ message: SSH_DISABLED, stdout: "" })),
  disconnectEnvironment: () => Effect.void,
  closeAllTunnels: Effect.void,
};

export const layerSshEnvironmentDisabled = Layer.succeed(
  DesktopSshEnvironment.DesktopSshEnvironment,
  sshEnvironmentDisabled,
);

/** The Apple Speech helper downloads on-device speech assets from Apple; the locked app has no voice. */
const speechUnavailable = { ok: false, code: "unavailable" } as const;

export const layerAppleSpeechDisabled = Layer.succeed(AppleSpeech.AppleSpeech, {
  supportedLocales: Effect.succeed([]),
  prepare: Effect.fn("AppleSpeech.AppleSpeech.prepare")(function* () {
    return speechUnavailable;
  }),
  transcribe: Effect.fn("AppleSpeech.AppleSpeech.transcribe")(function* () {
    return speechUnavailable;
  }),
});
