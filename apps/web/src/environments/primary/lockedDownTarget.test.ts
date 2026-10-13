import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { readPrimaryEnvironmentTarget } from "./target";
const localWindow = {
  location: { origin: "http://127.0.0.1:8123", href: "http://127.0.0.1:8123/" },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("locked-down primary connection", () => {
  it("ignores configured remote URL overrides", () => {
    vi.stubGlobal("window", localWindow);
    vi.stubEnv("VITE_HTTP_URL", "https://remote.example");
    vi.stubEnv("VITE_WS_URL", "wss://remote.example");
    expect(readPrimaryEnvironmentTarget()?.target).toEqual({
      httpBaseUrl: "http://127.0.0.1:8123/",
      wsBaseUrl: "ws://127.0.0.1:8123/",
    });
  });
  it("rejects remote desktop bootstrap endpoints", () => {
    vi.stubGlobal("window", {
      ...localWindow,
      desktopBridge: {
        getLocalEnvironmentBootstraps: () => [
          {
            id: "primary",
            httpBaseUrl: "https://remote.example",
            wsBaseUrl: "wss://remote.example",
          },
        ],
      },
    });
    expect(() => readPrimaryEnvironmentTarget()).toThrow("primary environment");
  });
  it("rejects a client hosted on a remote origin", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://remote.example", href: "https://remote.example/" },
    });
    expect(() => readPrimaryEnvironmentTarget()).toThrow("primary environment");
  });
});
