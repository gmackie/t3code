import { describe, expect, it } from "vite-plus/test";

import { extractClaudeAccessToken } from "./claudeUsageQuery.ts";

describe("claudeUsageQuery", () => {
  it("reads Claude Code's OAuth access token", () => {
    expect(extractClaudeAccessToken({ claudeAiOauth: { accessToken: "oauth-token" } })).toBe(
      "oauth-token",
    );
  });
});
