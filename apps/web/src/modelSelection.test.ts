import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  getServerModelOptionsByProvider,
  resolveSelectedModelForPickerWithCustomFallback,
} from "./modelSelection";

const providerStatuses: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.0.0-test",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-19T00:00:00.000Z",
    models: [{ slug: "gpt-5", name: "GPT-5", isCustom: false, capabilities: null }],
    slashCommands: [],
    skills: [],
  },
  {
    provider: "claudeAgent",
    enabled: true,
    installed: true,
    version: "0.0.0-test",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-19T00:00:00.000Z",
    models: [
      {
        slug: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        isCustom: false,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
  },
  {
    provider: "cursor",
    enabled: true,
    installed: true,
    version: "0.0.0-test",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-19T00:00:00.000Z",
    models: [
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
  },
  {
    provider: "opencode",
    enabled: true,
    installed: true,
    version: "0.0.0-test",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-19T00:00:00.000Z",
    models: [
      {
        slug: "openai/gpt-5",
        name: "GPT-5",
        isCustom: false,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
  },
];

describe("getServerModelOptionsByProvider", () => {
  it("returns model options for every supported provider", () => {
    expect(getServerModelOptionsByProvider(providerStatuses)).toEqual({
      codex: [{ slug: "gpt-5", name: "GPT-5", isCustom: false, capabilities: null }],
      claudeAgent: [
        {
          slug: "claude-sonnet-4-5",
          name: "Claude Sonnet 4.5",
          isCustom: false,
          capabilities: null,
        },
      ],
      cursor: [
        {
          slug: "claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          isCustom: false,
          capabilities: null,
        },
      ],
      opencode: [
        {
          slug: "openai/gpt-5",
          name: "GPT-5",
          isCustom: false,
          capabilities: null,
        },
      ],
    });
  });
});

describe("resolveSelectedModelForPickerWithCustomFallback", () => {
  it("supports cursor-backed selections without throwing", () => {
    expect(
      resolveSelectedModelForPickerWithCustomFallback({
        modelOptionsByProvider: getServerModelOptionsByProvider(providerStatuses),
        selectedProvider: "cursor",
        selectedModel: "claude-sonnet-4-6",
      }),
    ).toBe("claude-sonnet-4-6");
  });
});
