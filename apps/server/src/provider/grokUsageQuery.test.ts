import type * as Path from "effect/Path";
import { describe, expect, it } from "vite-plus/test";

import { extractGrokAccessToken, grokAuthFilePath } from "./grokUsageQuery.ts";

describe("grokUsageQuery", () => {
  it("reads the refreshable OIDC credential used by Grok Build", () => {
    expect(
      extractGrokAccessToken({
        "https://auth.x.ai::client-id": {
          key: "access-token",
          auth_mode: "oidc",
          refresh_token: "refresh-token",
          expires_at: "2026-08-22T00:00:00.000Z",
        },
        legacy: { key: "legacy-token" },
      }),
    ).toBe("access-token");
  });

  it("resolves the Grok auth file below the supplied home directory", () => {
    const path = { join: (...parts: ReadonlyArray<string>) => parts.join("/") } as Path.Path;
    expect(grokAuthFilePath(path, "/home/graham")).toBe("/home/graham/.grok/auth.json");
  });
});
