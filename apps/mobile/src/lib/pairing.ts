import { type PersistedSavedEnvironmentRecord } from "@t3tools/contracts";
import { parsePairingUrl, resolveSessionTarget } from "@t3tools/client-runtime";

import { bootstrapBearerSession, fetchEnvironmentDescriptor } from "./api";

export interface PairedEnvironmentResult {
  readonly record: PersistedSavedEnvironmentRecord;
  readonly sessionToken: string;
  readonly role: string | null;
}

export async function pairEnvironmentFromUrl(input: {
  readonly pairingUrl: string;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<PairedEnvironmentResult> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const parsed = parsePairingUrl(input.pairingUrl);
  const target = resolveSessionTarget(parsed.httpBaseUrl);
  const descriptor = await fetchEnvironmentDescriptor({
    httpBaseUrl: parsed.httpBaseUrl,
    fetch: fetchImpl,
  });
  const bearerSession = await bootstrapBearerSession({
    httpBaseUrl: parsed.httpBaseUrl,
    credential: parsed.credential,
    fetch: fetchImpl,
  });

  if (
    !bearerSession.authenticated ||
    bearerSession.sessionMethod !== "bearer-session-token" ||
    !bearerSession.sessionToken
  ) {
    throw new Error("Pairing did not produce a bearer session.");
  }

  const timestamp = new Date().toISOString();
  return {
    record: {
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      httpBaseUrl: target.httpBaseUrl,
      wsBaseUrl: target.wsBaseUrl,
      createdAt: timestamp,
      lastConnectedAt: null,
    },
    sessionToken: bearerSession.sessionToken,
    role: bearerSession.role,
  };
}
