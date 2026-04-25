import type { EnvironmentId, PersistedSavedEnvironmentRecord } from "@t3tools/contracts";
import { create } from "zustand";

import { createNativeMobileStorageBag, type MobileStorage, type MobileStorageBag } from "./storage";

export type MobileEnvironmentRecord = PersistedSavedEnvironmentRecord;

const REGISTRY_STORAGE_KEY = "t3code:mobile:saved-environment-registry:v1";
const SECRET_KEY_PREFIX = "t3code:mobile:saved-environment-secret:";

export interface MobileEnvironmentPersistence {
  readonly readRegistry: () => Promise<ReadonlyArray<MobileEnvironmentRecord>>;
  readonly writeRegistry: (records: ReadonlyArray<MobileEnvironmentRecord>) => Promise<void>;
  readonly readSecret: (environmentId: EnvironmentId) => Promise<string | null>;
  readonly writeSecret: (environmentId: EnvironmentId, secret: string) => Promise<void>;
  readonly removeSecret: (environmentId: EnvironmentId) => Promise<void>;
}

export interface EnvironmentStoreState {
  readonly recordsById: Record<EnvironmentId, MobileEnvironmentRecord>;
  readonly hydrated: boolean;
  readonly upsert: (record: MobileEnvironmentRecord) => void;
  readonly remove: (environmentId: EnvironmentId) => void;
  readonly hydrateComplete: (records: ReadonlyArray<MobileEnvironmentRecord>) => void;
  readonly reset: () => void;
}

function valuesOf(
  recordsById: Record<EnvironmentId, MobileEnvironmentRecord>,
): ReadonlyArray<MobileEnvironmentRecord> {
  return Object.values(recordsById) as ReadonlyArray<MobileEnvironmentRecord>;
}

function createSecretKey(environmentId: EnvironmentId): string {
  return `${SECRET_KEY_PREFIX}${environmentId}`;
}

async function readRegistryDocument(
  storage: MobileStorage,
): Promise<ReadonlyArray<MobileEnvironmentRecord>> {
  const rawDocument = await storage.getItem(REGISTRY_STORAGE_KEY);
  if (!rawDocument) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawDocument) as {
      readonly records?: ReadonlyArray<MobileEnvironmentRecord>;
    };
    return parsed.records ?? [];
  } catch {
    return [];
  }
}

export function createEnvironmentPersistence(
  storage: MobileStorageBag,
): MobileEnvironmentPersistence {
  return {
    readRegistry: () => readRegistryDocument(storage.metadata),
    writeRegistry: async (records) => {
      await storage.metadata.setItem(
        REGISTRY_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          records,
        }),
      );
    },
    readSecret: (environmentId) => storage.secrets.getItem(createSecretKey(environmentId)),
    writeSecret: (environmentId, secret) =>
      storage.secrets.setItem(createSecretKey(environmentId), secret),
    removeSecret: (environmentId) => storage.secrets.removeItem(createSecretKey(environmentId)),
  };
}

let nativePersistencePromise: Promise<MobileEnvironmentPersistence> | null = null;

export async function getNativeEnvironmentPersistence(): Promise<MobileEnvironmentPersistence> {
  if (!nativePersistencePromise) {
    nativePersistencePromise = createNativeMobileStorageBag().then((storage) =>
      createEnvironmentPersistence(storage),
    );
  }
  return nativePersistencePromise;
}

export const useEnvironmentStore = create<EnvironmentStoreState>()((set) => ({
  recordsById: {},
  hydrated: false,
  upsert: (record) =>
    set((state) => ({
      recordsById: {
        ...state.recordsById,
        [record.environmentId]: record,
      },
    })),
  remove: (environmentId) =>
    set((state) => {
      const { [environmentId]: _removed, ...remaining } = state.recordsById;
      return {
        recordsById: remaining,
      };
    }),
  hydrateComplete: (records) =>
    set({
      recordsById: Object.fromEntries(
        records.map((record) => [record.environmentId, record] as const),
      ) as Record<EnvironmentId, MobileEnvironmentRecord>,
      hydrated: true,
    }),
  reset: () =>
    set({
      recordsById: {},
      hydrated: false,
    }),
}));

export function listEnvironmentRecords(): ReadonlyArray<MobileEnvironmentRecord> {
  return valuesOf(useEnvironmentStore.getState().recordsById).toSorted((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export async function hydrateEnvironmentStore(
  persistence?: MobileEnvironmentPersistence,
): Promise<void> {
  const resolvedPersistence = persistence ?? (await getNativeEnvironmentPersistence());
  const records = await resolvedPersistence.readRegistry();
  useEnvironmentStore.getState().hydrateComplete(records);
}

export async function savePairedEnvironment(input: {
  readonly record: MobileEnvironmentRecord;
  readonly sessionToken: string;
  readonly persistence?: MobileEnvironmentPersistence;
}): Promise<void> {
  const persistence = input.persistence ?? (await getNativeEnvironmentPersistence());
  const currentRecords = useEnvironmentStore.getState().recordsById;
  const nextRecords = {
    ...currentRecords,
    [input.record.environmentId]: input.record,
  };
  await persistence.writeRegistry(valuesOf(nextRecords));
  await persistence.writeSecret(input.record.environmentId, input.sessionToken);
  useEnvironmentStore.getState().upsert(input.record);
}

export async function removePairedEnvironment(
  environmentId: EnvironmentId,
  persistence?: MobileEnvironmentPersistence,
): Promise<void> {
  const resolvedPersistence = persistence ?? (await getNativeEnvironmentPersistence());
  const currentRecords = useEnvironmentStore.getState().recordsById;
  const { [environmentId]: _removed, ...remaining } = currentRecords;
  await resolvedPersistence.writeRegistry(valuesOf(remaining));
  await resolvedPersistence.removeSecret(environmentId);
  useEnvironmentStore.getState().remove(environmentId);
}

export async function readEnvironmentSecret(
  environmentId: EnvironmentId,
  persistence?: MobileEnvironmentPersistence,
): Promise<string | null> {
  const resolvedPersistence = persistence ?? (await getNativeEnvironmentPersistence());
  return resolvedPersistence.readSecret(environmentId);
}

export function resetEnvironmentStoreForTests(): void {
  nativePersistencePromise = null;
  useEnvironmentStore.getState().reset();
}
