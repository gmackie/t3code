import { describe, expect, it } from "vitest";

import { buildSmolAgentAcpSpawnInput } from "./SmolAgentAcpSupport.ts";

describe("buildSmolAgentAcpSpawnInput", () => {
  it("builds the default smol-agent ACP command", () => {
    expect(buildSmolAgentAcpSpawnInput(undefined, "/tmp/project", "qwen2.5-coder:32b")).toEqual({
      command: "smol-agent",
      args: ["--model", "qwen2.5-coder:32b", "--acp", "-d", "/tmp/project"],
      cwd: "/tmp/project",
    });
  });

  it("includes configured provider host and api key when present", () => {
    expect(
      buildSmolAgentAcpSpawnInput(
        {
          binaryPath: "/usr/local/bin/smol-agent",
          llmProvider: "openai",
          host: "https://api.openai.com/v1",
          apiKey: "secret-key",
        },
        "/tmp/project",
        "gpt-4o",
      ),
    ).toEqual({
      command: "/usr/local/bin/smol-agent",
      args: [
        "--provider",
        "openai",
        "--host",
        "https://api.openai.com/v1",
        "--api-key",
        "secret-key",
        "--model",
        "gpt-4o",
        "--acp",
        "-d",
        "/tmp/project",
      ],
      cwd: "/tmp/project",
    });
  });
});
