import { describe, expect, it } from "vitest";

import type { ServerProvider } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { getCustomModelOptionsByProvider, resolveAppModelSelectionState } from "./modelSelection";

const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    provider: "smolAgent",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "unknown" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "qwen2.5-coder:32b",
        name: "Qwen 2.5 Coder 32B",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [],
          supportsFastMode: false,
          supportsThinkingToggle: false,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
];

describe("modelSelection", () => {
  it("returns smol-agent custom model options", () => {
    const options = getCustomModelOptionsByProvider(
      {
        ...DEFAULT_UNIFIED_SETTINGS,
        providers: {
          ...DEFAULT_UNIFIED_SETTINGS.providers,
          smolAgent: {
            ...DEFAULT_UNIFIED_SETTINGS.providers.smolAgent,
            customModels: ["gpt-4o"],
          },
        },
      },
      TEST_PROVIDERS,
      "smolAgent",
      "gpt-4o",
    );

    expect(options.smolAgent.map((option) => option.slug)).toEqual(["qwen2.5-coder:32b", "gpt-4o"]);
  });

  it("preserves smol-agent text generation selections without model options", () => {
    const selection = resolveAppModelSelectionState(
      {
        ...DEFAULT_UNIFIED_SETTINGS,
        textGenerationModelSelection: {
          provider: "smolAgent",
          model: "qwen2.5-coder:32b",
        },
      },
      TEST_PROVIDERS,
    );

    expect(selection).toEqual({
      provider: "smolAgent",
      model: "qwen2.5-coder:32b",
    });
  });
});
