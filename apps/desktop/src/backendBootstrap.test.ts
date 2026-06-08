// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it } from "vitest";

import type * as ChildProcess from "node:child_process";

import {
  DESKTOP_BACKEND_BOOTSTRAP_FD,
  DESKTOP_BACKEND_CHILD_STDIO,
  createDesktopBackendBootstrapPayload,
  createDesktopBackendEnv,
  getDesktopBackendBootstrapStream,
} from "./backendBootstrap.js";

describe("backendBootstrap", () => {
  it("uses a dedicated pipe for the bootstrap envelope and exposes its fd to the server", () => {
    expect(DESKTOP_BACKEND_BOOTSTRAP_FD).toBe(3);
    expect(DESKTOP_BACKEND_CHILD_STDIO).toEqual(["ignore", "pipe", "pipe", "pipe"]);
    expect(
      createDesktopBackendEnv({
        T3CODE_MODE: "desktop",
      }),
    ).toMatchObject({
      T3CODE_MODE: "desktop",
      T3CODE_BOOTSTRAP_FD: "3",
    });
  });

  it("returns the bootstrap pipe when the spawned child exposes a writable fd", () => {
    const writableBootstrapStream = {
      writable: true,
      write: () => true,
      end: () => undefined,
    };

    expect(
      getDesktopBackendBootstrapStream({
        stdio: [
          null,
          null,
          null,
          writableBootstrapStream,
          null,
        ] as unknown as ChildProcess.ChildProcess["stdio"],
      }),
    ).toBe(writableBootstrapStream);
  });

  it("returns null when the spawned child does not expose a writable bootstrap pipe", () => {
    expect(
      getDesktopBackendBootstrapStream({
        stdio: [null, null, null, null, null] as ChildProcess.ChildProcess["stdio"],
      }),
    ).toBeNull();
  });

  it("includes the desktop bootstrap credential in the server bootstrap envelope", () => {
    expect(
      createDesktopBackendBootstrapPayload({
        port: 3773,
        host: "0.0.0.0",
        t3Home: "/tmp/t3",
        stateDirName: "userdata-gmacko",
        authToken: "server-auth-token",
        desktopBootstrapToken: "desktop-bootstrap-token",
      }),
    ).toMatchObject({
      host: "0.0.0.0",
      stateDirName: "userdata-gmacko",
      desktopBootstrapToken: "desktop-bootstrap-token",
    });
  });
});
