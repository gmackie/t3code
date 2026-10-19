import type { SourceControlDiscoveryResult } from "@t3tools/contracts";
import * as Option from "effect/Option";

/**
 * Where an environment's ForgeGraph sign-in stands according to source control discovery, or
 * null when discovery has not found ForgeGraph there, so the settings page leaves it out.
 * The account is deliberately not read: clients never show it next to the sign-in controls.
 */
export function forgeGraphDiscoveryAuth(
  discovery: SourceControlDiscoveryResult | null,
): { readonly signedIn: boolean; readonly host: string | null } | null {
  const item = discovery?.sourceControlProviders.find((entry) => entry.kind === "forgegraph");
  if (!item) return null;
  return {
    signedIn: item.auth.status === "authenticated",
    host: Option.getOrNull(item.auth.host),
  };
}
