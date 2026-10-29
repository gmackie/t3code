import { describe, expect, it, vi } from "vite-plus/test";
import type { ExpoPushConnection } from "./expoPushRegistration";
import { EnvironmentId, type LiveActivityRegistration } from "@t3tools/contracts";
import {
  createEnvironmentLiveActivitySync,
  type NativeActivity,
} from "./environmentLiveActivities";

const connection = {
  environmentId: EnvironmentId.make("labtop"),
  httpBaseUrl: "https://labtop.t3coderelay.com",
  bearerToken: "paired-test-token",
};
const aggregate = {
  title: "T3 Code",
  subtitle: "Agent work in progress",
  activeCount: 1,
  updatedAt: "2026-01-01T00:00:00Z",
  activities: [],
};

function setup() {
  let storage: string | null = null;
  let instances: NativeActivity[] = [];
  let configured = true;
  let active = true;
  let foreground = true;
  let failRemoval = false;
  let failEnrollment = false;
  let pushToken = "a".repeat(64);
  let tokenListener: () => void = () => {};
  const registrations: LiveActivityRegistration[] = [];
  const register = vi.fn(
    async (_connection: ExpoPushConnection, registration: LiveActivityRegistration) => {
      if (failRemoval && registration.token === null) throw new Error("offline");
      if (failEnrollment && registration.token !== null) throw new Error("APNs rejected token");
      registrations.push(registration);
    },
  );
  const end = vi.fn(async () => {
    instances = [];
  });
  const activity: NativeActivity = {
    getId: () => "native-card",
    getPushToken: async () => pushToken,
    addPushTokenListener: (listener) => {
      tokenListener = listener;
      return { remove: vi.fn() };
    },
    update: vi.fn(async () => {}),
    end,
  };
  const start = vi.fn(() => {
    instances = [activity];
    return activity;
  });
  const snapshot = vi.fn(async () => ({
    configured,
    aggregate: { ...aggregate, activeCount: active ? 1 : 0 },
  }));
  const build = () =>
    createEnvironmentLiveActivitySync({
      snapshot,
      register,
      start,
      list: () => instances,
      read: async () => storage,
      write: async (value) => {
        storage = value;
      },
      onToken: vi.fn(),
      canStart: () => foreground,
    });
  return {
    build,
    registrations,
    start,
    end,
    snapshot,
    rotate: () => {
      pushToken = "b".repeat(64);
      tokenListener();
    },
    offlineRemoval: (value: boolean) => {
      failRemoval = value;
    },
    rejectEnrollment: () => {
      failEnrollment = true;
    },
    stop: () => {
      active = false;
    },
    noConfig: () => {
      configured = false;
    },
    background: () => {
      foreground = false;
    },
  };
}

describe("environment Live Activities", () => {
  it("ends a local card when its sender rejects enrollment", async () => {
    const test = setup();
    test.rejectEnrollment();
    expect(await test.build().synchronize({ labtop: connection }, true)).toMatchObject({
      active: 0,
      failed: 1,
    });
    expect(test.end).toHaveBeenCalledWith("immediate", undefined);
    expect(test.registrations.at(-1)?.token).toBeNull();
  });
  it("starts only with a configured sender, registers the native token, and repairs rotation after restart", async () => {
    const test = setup();
    const sync = test.build();
    await sync.synchronize({ labtop: connection }, true);
    expect(test.start).toHaveBeenCalledOnce();
    expect(test.registrations[0]).toEqual({ activityId: "native-card", token: "a".repeat(64) });
    await sync.synchronize({ labtop: connection }, true);
    expect(test.registrations).toHaveLength(1);
    test.rotate();
    await sync.synchronize({ labtop: connection }, true);
    expect(test.registrations.at(-1)?.token).toBe("b".repeat(64));
    sync.dispose();
    await test.build().synchronize({ labtop: connection }, true);
    expect(test.start).toHaveBeenCalledOnce();
    expect(test.registrations).toHaveLength(3);
    const unavailable = setup();
    unavailable.noConfig();
    expect(await unavailable.build().synchronize({ labtop: connection }, true)).toMatchObject({
      unavailable: 1,
    });
    expect(unavailable.start).not.toHaveBeenCalled();
  });

  it("ends terminal work and removes remote enrollment on disable or sign-out", async () => {
    const test = setup();
    const sync = test.build();
    await sync.synchronize({ labtop: connection }, true);
    test.stop();
    await sync.synchronize({ labtop: connection }, true);
    expect(test.end).toHaveBeenCalledWith("default", expect.objectContaining({ activeCount: 0 }));
    expect(test.registrations.at(-1)).toEqual({ activityId: null, token: null });
    for (const disabled of [true, false]) {
      const other = setup();
      const controller = other.build();
      await controller.synchronize({ labtop: connection }, true);
      await controller.synchronize(disabled ? { labtop: connection } : {}, !disabled);
      expect(other.end).toHaveBeenCalledWith("immediate", undefined);
      expect(other.registrations.at(-1)?.token).toBeNull();
    }
  });

  it("retains failed cleanup across app restarts without creating a duplicate card", async () => {
    const test = setup();
    const sync = test.build();
    await sync.synchronize({ labtop: connection }, true);
    test.offlineRemoval(true);
    expect(await sync.synchronize({}, true)).toMatchObject({ failed: 1 });
    sync.dispose();
    const restarted = test.build();
    await restarted.synchronize({ labtop: connection }, true);
    expect(test.start).toHaveBeenCalledOnce();
    test.offlineRemoval(false);
    await restarted.synchronize({}, true);
    expect(test.registrations.at(-1)?.token).toBeNull();
  });

  it("does not start a card while suspended or after a preference changed during discovery", async () => {
    const test = setup();
    test.background();
    await test.build().synchronize({ labtop: connection }, true);
    expect(test.start).not.toHaveBeenCalled();
    const changed = setup();
    let current = true;
    changed.snapshot.mockImplementationOnce(async () => {
      current = false;
      return { configured: true, aggregate };
    });
    await changed.build().synchronize({ labtop: connection }, true, () => current);
    expect(changed.start).not.toHaveBeenCalled();
  });
});
