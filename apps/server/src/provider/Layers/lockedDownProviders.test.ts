import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

import { deriveProviderInstanceConfigMap } from "./ProviderInstanceRegistryHydration.ts";

describe("locked-down provider hydration", () => {
  it("does not hydrate other legacy providers even if saved settings enable them", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        [ProviderInstanceId.make("codex")]: {
          ...DEFAULT_SERVER_SETTINGS.providers.codex,
          enabled: true,
        },
        claudeAgent: { ...DEFAULT_SERVER_SETTINGS.providers.claudeAgent, enabled: true },
        opencode: { ...DEFAULT_SERVER_SETTINGS.providers.opencode, enabled: true },
      },
    };

    const instances = deriveProviderInstanceConfigMap(settings);
    expect(Object.keys(instances)).toEqual(["opencode"]);
    expect(instances[ProviderInstanceId.make("opencode")]?.config).toEqual(
      settings.providers.opencode,
    );
  });

  it("drops explicit non-OpenCode drivers and retains custom OpenCode instances", () => {
    const localConfig = { enabled: true, binaryPath: "/opt/approved/opencode" };
    const instances = deriveProviderInstanceConfigMap({
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("injected")]: {
          driver: ProviderDriverKind.make("acpRegistry"),
          config: {},
        },
        [ProviderInstanceId.make("codex")]: {
          driver: ProviderDriverKind.make("codex"),
          config: { enabled: true },
        },
        [ProviderInstanceId.make("work")]: {
          driver: ProviderDriverKind.make("opencode"),
          config: localConfig,
        },
      },
    });

    expect(Object.keys(instances).sort()).toEqual(["opencode", "work"]);
    expect(instances[ProviderInstanceId.make("work")]?.config).toEqual(localConfig);
  });
});
