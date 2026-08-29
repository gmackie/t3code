import { describe, expect, it } from "vite-plus/test";
import type * as Path from "effect/Path";

import {
  claudeCredentialsFilePath,
  extractClaudeAccessToken,
  selectClaudeAccessToken,
} from "./claudeUsageQuery.ts";

describe("claudeUsageQuery", () => {
  it("uses the configured Claude account home", () => {
    const path = { join: (...parts: ReadonlyArray<string>) => parts.join("/") } as Path.Path;

    expect(
      claudeCredentialsFilePath(path, { CLAUDE_CONFIG_DIR: "/accounts/work" }, "/home/graham"),
    ).toBe("/accounts/work/.credentials.json");
  });

  it("reads Claude Code's OAuth access token", () => {
    expect(extractClaudeAccessToken({ claudeAiOauth: { accessToken: "oauth-token" } })).toBe(
      "oauth-token",
    );
  });

  it("falls back to Claude Code's macOS keychain credential", () => {
    expect(
      selectClaudeAccessToken({
        fileCredential: undefined,
        environmentToken: undefined,
        keychainCredential: JSON.stringify({
          claudeAiOauth: { accessToken: "keychain-oauth-token" },
        }),
      }),
    ).toBe("keychain-oauth-token");
  });

  it("keeps an explicit environment token ahead of stored credentials", () => {
    expect(
      selectClaudeAccessToken({
        fileCredential: { claudeAiOauth: { accessToken: "file-token" } },
        environmentToken: "environment-token",
        keychainCredential: JSON.stringify({
          claudeAiOauth: { accessToken: "keychain-token" },
        }),
      }),
    ).toBe("environment-token");
  });
});
