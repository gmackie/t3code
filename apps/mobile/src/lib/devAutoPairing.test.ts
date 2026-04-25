import type { PersistedSavedEnvironmentRecord } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDevAutoPairingForTests, runDevAutoPairingOnce } from "./devAutoPairing";

const record = {
  environmentId: "env_dev_pair" as never,
  label: "Simulator Mac",
  httpBaseUrl: "http://127.0.0.1:3773/",
  wsBaseUrl: "ws://127.0.0.1:3773/",
  createdAt: "2026-04-25T00:00:00.000Z",
  lastConnectedAt: null,
} satisfies PersistedSavedEnvironmentRecord;

describe("runDevAutoPairingOnce", () => {
  beforeEach(() => {
    resetDevAutoPairingForTests();
  });

  it("pairs once when a dev pairing URL is configured and no environments exist", async () => {
    const saved: Array<{
      readonly record: PersistedSavedEnvironmentRecord;
      readonly token: string;
    }> = [];

    const result = await runDevAutoPairingOnce({
      pairingUrl: " http://127.0.0.1:3773/pair#token=TOKEN ",
      hydrateEnvironmentStore: async () => undefined,
      listEnvironmentRecords: () => [],
      pairEnvironmentFromUrl: async ({ pairingUrl }) => {
        expect(pairingUrl).toBe("http://127.0.0.1:3773/pair#token=TOKEN");
        return {
          record,
          sessionToken: "session-token",
        };
      },
      savePairedEnvironment: async ({ record, sessionToken }) => {
        saved.push({ record, token: sessionToken });
      },
    });

    expect(result).toBe("paired");
    expect(saved).toEqual([{ record, token: "session-token" }]);

    const second = await runDevAutoPairingOnce({
      pairingUrl: "http://127.0.0.1:3773/pair#token=TOKEN",
      hydrateEnvironmentStore: async () => undefined,
      listEnvironmentRecords: () => [],
      pairEnvironmentFromUrl: async () => {
        throw new Error("should not pair twice");
      },
      savePairedEnvironment: async () => undefined,
    });
    expect(second).toBe("already-attempted");
  });

  it("skips when no dev pairing URL is configured", async () => {
    await expect(
      runDevAutoPairingOnce({
        pairingUrl: "",
        hydrateEnvironmentStore: async () => undefined,
        listEnvironmentRecords: () => [],
        pairEnvironmentFromUrl: async () => {
          throw new Error("should not pair");
        },
        savePairedEnvironment: async () => undefined,
      }),
    ).resolves.toBe("not-configured");
  });

  it("allows retry after a failed pairing attempt", async () => {
    await expect(
      runDevAutoPairingOnce({
        pairingUrl: "http://127.0.0.1:3773/pair#token=TOKEN",
        hydrateEnvironmentStore: async () => undefined,
        listEnvironmentRecords: () => [],
        pairEnvironmentFromUrl: async () => {
          throw new Error("pairing service unavailable");
        },
        savePairedEnvironment: async () => undefined,
      }),
    ).rejects.toThrow("pairing service unavailable");

    await expect(
      runDevAutoPairingOnce({
        pairingUrl: "http://127.0.0.1:3773/pair#token=TOKEN",
        hydrateEnvironmentStore: async () => undefined,
        listEnvironmentRecords: () => [],
        pairEnvironmentFromUrl: async () => ({
          record,
          sessionToken: "session-token",
        }),
        savePairedEnvironment: async () => undefined,
      }),
    ).resolves.toBe("paired");
  });
});
