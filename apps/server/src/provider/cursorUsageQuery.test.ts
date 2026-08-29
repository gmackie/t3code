import { describe, expect, it } from "vite-plus/test";

import { cursorUserIdFromAccessToken } from "./cursorUsageQuery.ts";

describe("cursorUsageQuery", () => {
  it("reads the Cursor user id from the access-token JWT subject", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user_123" })).toString("base64url");
    expect(cursorUserIdFromAccessToken(`header.${payload}.signature`)).toBe("user_123");
  });

  it("rejects malformed or subject-less access tokens", () => {
    expect(cursorUserIdFromAccessToken("not-a-jwt")).toBeUndefined();
    const payload = Buffer.from(JSON.stringify({ aud: "cursor" })).toString("base64url");
    expect(cursorUserIdFromAccessToken(`header.${payload}.signature`)).toBeUndefined();
  });
});
