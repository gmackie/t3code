import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { describe, expect, it } from "vitest";

import { maybeSyncNightlyEnvironmentToGmacko } from "./startupStateSync.ts";

function makeTempDir(prefix: string): string {
  return FS.mkdtempSync(Path.join(OS.tmpdir(), prefix));
}

describe("maybeSyncNightlyEnvironmentToGmacko", () => {
  it("does nothing unless gmacko startup sync is explicitly enabled", () => {
    const tempDir = makeTempDir("t3-gmacko-sync-disabled-");
    const sourceStateDir = Path.join(tempDir, "source");
    const targetStateDir = Path.join(tempDir, "target");
    FS.mkdirSync(sourceStateDir, { recursive: true });
    FS.writeFileSync(Path.join(sourceStateDir, "settings.json"), "{}");

    expect(
      maybeSyncNightlyEnvironmentToGmacko({
        isGmacko: true,
        enabledValue: undefined,
        sourceStateDir,
        targetStateDir,
      }),
    ).toEqual({ copied: false, reason: "disabled" });
    expect(FS.existsSync(targetStateDir)).toBe(false);
  });

  it("copies the nightly state into the isolated gmacko state directory", () => {
    const tempDir = makeTempDir("t3-gmacko-sync-");
    const sourceStateDir = Path.join(tempDir, "nightly", "userdata");
    const targetStateDir = Path.join(tempDir, "gmacko", "userdata-gmacko");
    FS.mkdirSync(Path.join(sourceStateDir, "secrets"), { recursive: true });
    FS.mkdirSync(Path.join(sourceStateDir, "logs"), { recursive: true });
    FS.writeFileSync(Path.join(sourceStateDir, "state.sqlite"), "source-db");
    FS.writeFileSync(Path.join(sourceStateDir, "settings.json"), "settings");
    FS.writeFileSync(Path.join(sourceStateDir, "secrets", "token"), "secret");
    FS.writeFileSync(Path.join(sourceStateDir, "logs", "server.log"), "noise");
    FS.mkdirSync(targetStateDir, { recursive: true });
    FS.writeFileSync(Path.join(targetStateDir, "state.sqlite-shm"), "stale-sidecar");

    expect(
      maybeSyncNightlyEnvironmentToGmacko({
        isGmacko: true,
        enabledValue: "1",
        sourceStateDir,
        targetStateDir,
      }),
    ).toEqual({ copied: true });

    expect(FS.readFileSync(Path.join(targetStateDir, "state.sqlite"), "utf8")).toBe("source-db");
    expect(FS.readFileSync(Path.join(targetStateDir, "settings.json"), "utf8")).toBe("settings");
    expect(FS.readFileSync(Path.join(targetStateDir, "secrets", "token"), "utf8")).toBe("secret");
    expect(FS.existsSync(Path.join(targetStateDir, "state.sqlite-shm"))).toBe(false);
    expect(FS.existsSync(Path.join(targetStateDir, "logs", "server.log"))).toBe(false);
  });
});
