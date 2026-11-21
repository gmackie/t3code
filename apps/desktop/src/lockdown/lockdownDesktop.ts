/**
 * lockdownDesktop - the desktop side of T3 Code Locked (see `@t3tools/shared/lockdownEdition`).
 *
 * @module lockdownDesktop
 */
import { SshInvalidTargetError, SshLaunchError } from "@t3tools/ssh/errors";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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

const SSH_DISABLED = "Remote SSH environments are disabled in T3 Code Locked.";

/** SSH environments start a T3 server on another machine; the locked app never does. */
export const sshEnvironmentDisabled: DesktopSshEnvironment.DesktopSshEnvironment["Service"] = {
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
