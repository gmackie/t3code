import type { PersistedSavedEnvironmentRecord } from "@t3tools/contracts";

export type DevAutoPairingStatus =
  | "already-attempted"
  | "already-paired"
  | "not-configured"
  | "paired";

interface DevAutoPairingDependencies {
  readonly pairingUrl: string | undefined;
  readonly hydrateEnvironmentStore: () => Promise<void>;
  readonly listEnvironmentRecords: () => ReadonlyArray<PersistedSavedEnvironmentRecord>;
  readonly pairEnvironmentFromUrl: (input: { readonly pairingUrl: string }) => Promise<{
    readonly record: PersistedSavedEnvironmentRecord;
    readonly sessionToken: string;
  }>;
  readonly savePairedEnvironment: (input: {
    readonly record: PersistedSavedEnvironmentRecord;
    readonly sessionToken: string;
  }) => Promise<void>;
}

let devAutoPairingAttempted = false;

export async function runDevAutoPairingOnce(
  dependencies: DevAutoPairingDependencies,
): Promise<DevAutoPairingStatus> {
  if (devAutoPairingAttempted) {
    return "already-attempted";
  }

  const pairingUrl = dependencies.pairingUrl?.trim();
  if (!pairingUrl) {
    return "not-configured";
  }

  try {
    await dependencies.hydrateEnvironmentStore();
    if (dependencies.listEnvironmentRecords().length > 0) {
      devAutoPairingAttempted = true;
      return "already-paired";
    }

    const paired = await dependencies.pairEnvironmentFromUrl({ pairingUrl });
    await dependencies.savePairedEnvironment({
      record: paired.record,
      sessionToken: paired.sessionToken,
    });
    devAutoPairingAttempted = true;
    return "paired";
  } catch (error) {
    devAutoPairingAttempted = false;
    throw error;
  }
}

export function resetDevAutoPairingForTests(): void {
  devAutoPairingAttempted = false;
}
