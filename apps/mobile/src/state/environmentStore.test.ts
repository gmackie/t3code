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

  it("uses SecureStore-compatible keys for bearer token secrets", async () => {
    const secretValues = new Map<string, string>();
    const persistence = createEnvironmentPersistence({
      metadata: createInMemoryMobileStorageBag().metadata,
      secrets: {
        getItem: async (key) => secretValues.get(key) ?? null,
        setItem: async (key, value) => {
          if (!/^[A-Za-z0-9._-]+$/.test(key)) {
            throw new Error(`Invalid SecureStore key: ${key}`);
          }
          secretValues.set(key, value);
        },
        removeItem: async (key) => {
          secretValues.delete(key);
        },
      },
    });

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

    await expect(
      readEnvironmentSecret("env_mobile_test" as EnvironmentId, persistence),
    ).resolves.toBe("session-token");
  });

  it("lists environments without requiring Hermes-missing array copy methods", async () => {
    const toSortedDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
    // Hermes in the current iOS simulator runtime does not provide toSorted.
    Reflect.deleteProperty(Array.prototype, "toSorted");
    try {
      const persistence = createEnvironmentPersistence(createInMemoryMobileStorageBag());
      await hydrateEnvironmentStore(persistence);

      await savePairedEnvironment({
        persistence,
        record: {
          environmentId: "env_b" as EnvironmentId,
          label: "Beta",
          httpBaseUrl: "http://100.88.12.5:3773/",
          wsBaseUrl: "ws://100.88.12.5:3773/",
          createdAt: "2026-04-25T00:00:00.000Z",
          lastConnectedAt: null,
        },
        sessionToken: "session-token-b",
      });
      await savePairedEnvironment({
        persistence,
        record: {
          environmentId: "env_a" as EnvironmentId,
          label: "Alpha",
          httpBaseUrl: "http://100.88.12.4:3773/",
          wsBaseUrl: "ws://100.88.12.4:3773/",
          createdAt: "2026-04-25T00:00:00.000Z",
          lastConnectedAt: null,
        },
        sessionToken: "session-token-a",
      });

      expect(listEnvironmentRecords().map((record) => record.label)).toEqual(["Alpha", "Beta"]);
    } finally {
      if (toSortedDescriptor) {
        // eslint-disable-next-line no-extend-native -- Test restores the simulated Hermes runtime gap.
        Object.defineProperty(Array.prototype, "toSorted", toSortedDescriptor);
      }
    }
  });
});
