// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vitest";

import { maybeSyncNightlyEnvironmentToGmacko } from "./startupStateSync.ts";

function makeTempDir(prefix: string): string {
  return NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
}

describe("maybeSyncNightlyEnvironmentToGmacko", () => {
  it("does nothing unless gmacko startup sync is explicitly enabled", () => {
    const tempDir = makeTempDir("t3-gmacko-sync-disabled-");
    const sourceStateDir = NodePath.join(tempDir, "source");
    const targetStateDir = NodePath.join(tempDir, "target");
    NodeFS.mkdirSync(sourceStateDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(sourceStateDir, "settings.json"), "{}");

    expect(
      maybeSyncNightlyEnvironmentToGmacko({
        isGmacko: true,
        enabledValue: undefined,
        sourceStateDir,
        targetStateDir,
      }),
    ).toEqual({ copied: false, reason: "disabled" });
    expect(NodeFS.existsSync(targetStateDir)).toBe(false);
  });

  it("copies the nightly state into the isolated gmacko state directory", () => {
    const tempDir = makeTempDir("t3-gmacko-sync-");
    const sourceStateDir = NodePath.join(tempDir, "nightly", "userdata");
    const targetStateDir = NodePath.join(tempDir, "gmacko", "userdata-gmacko");
    NodeFS.mkdirSync(NodePath.join(sourceStateDir, "secrets"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(sourceStateDir, "logs"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(sourceStateDir, "state.sqlite"), "source-db");
    NodeFS.writeFileSync(NodePath.join(sourceStateDir, "settings.json"), "settings");
    NodeFS.writeFileSync(NodePath.join(sourceStateDir, "secrets", "token"), "secret");
    NodeFS.writeFileSync(NodePath.join(sourceStateDir, "logs", "server.log"), "noise");
    NodeFS.mkdirSync(targetStateDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(targetStateDir, "state.sqlite-shm"), "stale-sidecar");

    expect(
      maybeSyncNightlyEnvironmentToGmacko({
        isGmacko: true,
        enabledValue: "1",
        sourceStateDir,
        targetStateDir,
      }),
    ).toEqual({ copied: true });

    expect(NodeFS.readFileSync(NodePath.join(targetStateDir, "state.sqlite"), "utf8")).toBe(
      "source-db",
    );
    expect(NodeFS.readFileSync(NodePath.join(targetStateDir, "settings.json"), "utf8")).toBe(
      "settings",
    );
    expect(NodeFS.readFileSync(NodePath.join(targetStateDir, "secrets", "token"), "utf8")).toBe(
      "secret",
    );
    expect(NodeFS.existsSync(NodePath.join(targetStateDir, "state.sqlite-shm"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(targetStateDir, "logs", "server.log"))).toBe(false);
  });
});
