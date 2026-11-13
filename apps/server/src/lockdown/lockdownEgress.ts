/**
 * T3 Code Locked: in-process `fetch` and undici requests reach only loopback and the hosts in
 * `T3CODE_LOCKDOWN_ALLOWED_HOSTS`. Child processes (OpenCode, git, glab, browsers) are outside it.
 */
import * as NodeModule from "node:module";

import {
  installLockdownFetchGuard,
  LOCKDOWN_EDITION,
  lockdownAllowedHosts,
  lockdownDispatchInterceptor,
} from "@t3tools/shared/lockdownEdition";
import type * as Undici from "undici";

// undici is external to the CLI bundle; Node single-executables can load it from disk only with require.
const requireUndici = NodeModule.createRequire(import.meta.url);

/** Install after anything else that replaces the global dispatcher. */
export function installLockdownEgressGuard(
  env: Readonly<Record<string, string | undefined>>,
  loadUndici: () => typeof Undici = () => requireUndici("undici") as typeof Undici,
  target: { fetch: typeof fetch } = globalThis,
): void {
  if (!LOCKDOWN_EDITION) return;
  installLockdownFetchGuard(target, env);
  const undici = loadUndici();
  const interceptor = lockdownDispatchInterceptor(lockdownAllowedHosts(env));
  undici.setGlobalDispatcher(
    undici
      .getGlobalDispatcher()
      .compose(interceptor as unknown as Undici.Dispatcher.DispatcherComposeInterceptor),
  );
}
