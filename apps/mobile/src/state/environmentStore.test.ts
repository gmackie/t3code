import type { EnvironmentId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createEnvironmentPersistence,
  hydrateEnvironmentStore,
  listEnvironmentRecords,
  readEnvironmentSecret,
  resetEnvironmentStoreForTests,
  savePairedEnvironment,
} from "./environmentStore";
import { createInMemoryMobileStorageBag } from "./storage";

describe("environmentStore", () => {
  beforeEach(() => {
    resetEnvironmentStoreForTests();
  });

  it("persists paired environments and their bearer tokens", async () => {
    const persistence = createEnvironmentPersistence(createInMemoryMobileStorageBag());

    await savePairedEnvironment({
      persistence,
      record: {
        environmentId: "env_mobile_test" as EnvironmentId,
        label: "Mackbook Pro",
        httpBaseUrl: "http://100.88.12.4:3773/",
        wsBaseUrl: "ws://100.88.12.4:3773/",
        createdAt: "2026-04-25T00:00:00.000Z",
        lastConnectedAt: null,
      },
      sessionToken: "session-token",
    });

    resetEnvironmentStoreForTests();
    await hydrateEnvironmentStore(persistence);

    expect(listEnvironmentRecords()).toHaveLength(1);
    await expect(
      readEnvironmentSecret("env_mobile_test" as EnvironmentId, persistence),
    ).resolves.toBe("session-token");
  });
});
