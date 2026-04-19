import { describe, expect, it } from "vitest";

import { createStageDependencyOverrides } from "./lib/stageDependencyOverrides.ts";

describe("createStageDependencyOverrides", () => {
  it("pins the effect runtime family to exact workspace-compatible versions", () => {
    expect(
      createStageDependencyOverrides({
        catalog: {
          effect: "4.0.0-beta.43",
          "@effect/platform-bun": "4.0.0-beta.43",
          "@effect/platform-node": "4.0.0-beta.43",
          "@effect/sql-sqlite-bun": "4.0.0-beta.43",
        },
        platformNodeSharedVersion: "4.0.0-beta.43",
      }),
    ).toEqual({
      effect: "4.0.0-beta.43",
      "@effect/platform-bun": "4.0.0-beta.43",
      "@effect/platform-node": "4.0.0-beta.43",
      "@effect/platform-node-shared": "4.0.0-beta.43",
      "@effect/sql-sqlite-bun": "4.0.0-beta.43",
    });
  });
});
