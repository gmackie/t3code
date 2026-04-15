import { describe, expect, it } from "vitest";

import { createLocalEnvironmentBootstrap } from "./localEnvironmentBootstrap";

describe("createLocalEnvironmentBootstrap", () => {
  it("returns matching http and websocket base urls", () => {
    expect(
      createLocalEnvironmentBootstrap({
        label: "Local environment",
        wsBaseUrl: "ws://127.0.0.1:3773/",
      }),
    ).toEqual({
      label: "Local environment",
      httpBaseUrl: "http://127.0.0.1:3773/",
      wsBaseUrl: "ws://127.0.0.1:3773/",
      wsUrl: "ws://127.0.0.1:3773/",
    });
  });

  it("preserves null urls when the backend is not available", () => {
    expect(
      createLocalEnvironmentBootstrap({
        label: "Local environment",
        wsBaseUrl: null,
      }),
    ).toEqual({
      label: "Local environment",
      httpBaseUrl: null,
      wsBaseUrl: null,
      wsUrl: null,
    });
  });
});
