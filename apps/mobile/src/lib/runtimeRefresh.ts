import type { EnvironmentId, OrchestrationReadModel } from "@t3tools/contracts";

import { loadSavedEnvironmentSnapshot } from "./runtimeClient";
import {
  hydrateEnvironmentStore,
  readEnvironmentSecret,
  useEnvironmentStore,
  type MobileEnvironmentRecord,
} from "../state/environmentStore";

export type MobileRuntimeConnectionState = "idle" | "syncing" | "ready" | "error";

export interface RuntimeSnapshotSink {
  readonly applySnapshot: (environmentId: EnvironmentId, snapshot: OrchestrationReadModel) => void;
  readonly setConnectionState: (
    environmentId: EnvironmentId,
    state: MobileRuntimeConnectionState,
  ) => void;
}

export async function refreshEnvironmentRuntime(
  record: MobileEnvironmentRecord,
  sink: RuntimeSnapshotSink,
): Promise<void> {
  const token = await readEnvironmentSecret(record.environmentId);
  if (!token) {
    return;
  }

  sink.setConnectionState(record.environmentId, "syncing");
  try {
    const loaded = await loadSavedEnvironmentSnapshot({
      record,
      sessionToken: token,
    });
    sink.applySnapshot(loaded.environmentId, loaded.snapshot);
  } catch (error) {
    sink.setConnectionState(record.environmentId, "error");
    throw error;
  }
}

export async function refreshEnvironmentRuntimeById(
  environmentId: EnvironmentId,
  sink: RuntimeSnapshotSink,
): Promise<MobileEnvironmentRecord | null> {
  await hydrateEnvironmentStore();
  const record = useEnvironmentStore.getState().recordsById[environmentId] ?? null;
  if (!record) {
    return null;
  }

  await refreshEnvironmentRuntime(record, sink);
  return record;
}

export async function refreshAllEnvironmentRuntimes(sink: RuntimeSnapshotSink): Promise<void> {
  await hydrateEnvironmentStore();
  const records = Object.values(useEnvironmentStore.getState().recordsById);
  await Promise.all(
    records.map(async (record) => {
      try {
        await refreshEnvironmentRuntime(record, sink);
      } catch (error) {
        console.error("[mobile] failed to refresh runtime", error);
      }
    }),
  );
}
