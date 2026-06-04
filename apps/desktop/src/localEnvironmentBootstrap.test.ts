import { describe, expect, it } from "vitest";

import { createLocalEnvironmentBootstrap } from "./localEnvironmentBootstrap.js";

describe("localEnvironmentBootstrap", () => {
  it("preserves the desktop bootstrap token for the renderer auth flow", () => {
    expect(
      createLocalEnvironmentBootstrap({
        label: "Local environment",
        wsBaseUrl: "ws://127.0.0.1:3773/?token=backend",
        bootstrapToken: "desktop-bootstrap-token",
      }),
    ).toMatchObject({
      bootstrapToken: "desktop-bootstrap-token",
    });
  });
});
