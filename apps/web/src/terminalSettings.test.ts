import { describe, expect, it } from "vitest";

import { parseTerminalEnvironmentText, resolveTerminalSettingsEnv } from "./terminalSettings";

describe("parseTerminalEnvironmentText", () => {
  it("parses KEY=value lines and ignores comments", () => {
    expect(
      parseTerminalEnvironmentText(
        ["# local terminal flags", "T3_SANDBOX=1", "FEATURE_FLAG=true"].join("\n"),
      ),
    ).toEqual({
      T3_SANDBOX: "1",
      FEATURE_FLAG: "true",
    });
  });
});

describe("resolveTerminalSettingsEnv", () => {
  it("adds ZDOTDIR when a zsh startup directory is configured", () => {
    expect(
      resolveTerminalSettingsEnv({
        environmentVariablesText: "CUSTOM_FLAG=1",
        zshStartupDirectory: "~/t3code-shell",
      }),
    ).toEqual({
      CUSTOM_FLAG: "1",
      ZDOTDIR: "~/t3code-shell",
    });
  });
});
