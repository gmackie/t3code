import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { createExpoPushRegistration, type ExpoPushConnection } from "./expoPushRegistration";

const connection: ExpoPushConnection = {
  environmentId: EnvironmentId.make("env"),
  httpBaseUrl: "http://tailnet:4000",
  bearerToken: "paired-token",
};

describe("Expo registration reconciliation", () => {
  it("keeps push registered when the foreground connection loses its prepared credential", async () => {
    const register = vi.fn(async (_connection: ExpoPushConnection, _token: string | null) => {});
    const sync = createExpoPushRegistration(register);
    await sync({ env: connection }, "expo-token");
    await sync({ env: { ...connection, bearerToken: null } }, "expo-token");
    expect(register.mock.calls).toEqual([
      [connection, "expo-token"],
      [connection, "expo-token"],
    ]);
  });
  it("uses the replacement credential after re-pairing", async () => {
    const register = vi.fn(async (_connection: ExpoPushConnection, _token: string | null) => {});
    const sync = createExpoPushRegistration(register);
    await sync({ env: connection }, "expo-token");
    const replacement = { ...connection, bearerToken: "new-token" };
    await sync({ env: replacement }, "expo-token");
    expect(register).toHaveBeenLastCalledWith(replacement, "expo-token");
  });
  it("retries disabling notifications after an environment comes back online", async () => {
    const register = vi.fn(async (_connection: ExpoPushConnection, _token: string | null) => {});
    const sync = createExpoPushRegistration(register);
    await sync({ env: connection }, "expo-token");
    register.mockRejectedValueOnce(new Error("offline"));
    expect(await sync({ env: connection }, null)).toEqual({ registered: 0, failed: 1 });
    expect(await sync({ env: connection }, null)).toEqual({ registered: 0, failed: 0 });
    expect(register).toHaveBeenLastCalledWith(connection, null);
  });
  it("finishes an offline removal after the app restarts", async () => {
    let persisted: string | null = null;
    const storage = {
      read: async () => persisted,
      write: async (value: string) => {
        persisted = value;
      },
    };
    const register = vi.fn(async (_connection: ExpoPushConnection, _token: string | null) => {});
    const sync = createExpoPushRegistration(register, storage);
    await sync({ env: connection }, "expo-token");
    register.mockRejectedValueOnce(new Error("offline"));
    await sync({}, "expo-token");
    const restarted = createExpoPushRegistration(register, storage);
    expect(await restarted({}, "expo-token")).toEqual({ registered: 0, failed: 0 });
    expect(register).toHaveBeenLastCalledWith(connection, null);
  });

  it("retries an unsuccessful unregister after removing an environment", async () => {
    const register = vi.fn(async (_connection: ExpoPushConnection, _token: string | null) => {});
    const sync = createExpoPushRegistration(register);
    await sync({ env: connection }, "expo-token");
    register.mockRejectedValueOnce(new Error("offline"));
    expect(await sync({}, "expo-token")).toEqual({ registered: 0, failed: 1 });
    expect(await sync({}, "expo-token")).toEqual({ registered: 0, failed: 0 });
    expect(register).toHaveBeenLastCalledWith(connection, null);
    register.mockClear();
    await sync({}, "expo-token");
    expect(register).not.toHaveBeenCalled();
  });
});
