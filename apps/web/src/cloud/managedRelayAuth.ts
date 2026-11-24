import { ManagedRelay, setManagedRelaySession } from "@t3tools/client-runtime/relay";
import {
  reportAtomCommandResult,
  runAtomCommand,
  settleAsyncResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";

import { environmentCatalog } from "../connection/catalog";
import { runtime } from "../lib/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

export function deactivateManagedRelayAuthentication(): void {
  setManagedRelaySession(appAtomRegistry, null);
}

export function activateManagedRelayAuthentication(
  accountId: string,
  readClerkToken: () => Promise<string | null>,
): void {
  setManagedRelaySession(appAtomRegistry, {
    accountId,
    readClerkToken,
  });
}

// A failed route removal fails the switch, so the next account never activates over the old routes.
export async function cleanUpManagedRelayAccount(): Promise<void> {
  const [removal, tokenReset] = await Promise.all([
    runAtomCommand(appAtomRegistry, environmentCatalog.removeRelayEnvironments, undefined, {
      reportFailure: false,
      reportDefect: false,
    }),
    settleAsyncResult(() =>
      runtime.runPromiseExit(
        ManagedRelay.ManagedRelayClient.pipe(Effect.flatMap((client) => client.resetTokenCache)),
      ),
    ),
  ]);
  reportAtomCommandResult(tokenReset, { label: "cloud account cleanup" });
  if (removal._tag !== "Success") throw squashAtomCommandFailure(removal);
}
