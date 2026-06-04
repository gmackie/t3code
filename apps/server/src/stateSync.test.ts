import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseT3StateSyncCliArgs, resolveT3StateProfile, syncT3State } from "./stateSync.ts";

describe("stateSync", () => {
  it("resolves stable and gmacko state profiles to separate default homes", () => {
    const homeDir = path.join(os.tmpdir(), "t3-state-sync-home");

    expect(resolveT3StateProfile("stable", { homeDir })).toEqual({
      baseDir: path.join(homeDir, ".t3"),
      stateDir: path.join(homeDir, ".t3", "userdata"),
    });
    expect(resolveT3StateProfile("gmacko", { homeDir })).toEqual({
      baseDir: path.join(homeDir, ".t3-gmacko"),
      stateDir: path.join(homeDir, ".t3-gmacko", "userdata-gmacko"),
    });
  });

  it("copies state files recursively while skipping logs by default", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "t3-state-sync-"));
    const sourceStateDir = path.join(tempDir, "source", "userdata");
    const targetStateDir = path.join(tempDir, "target", "userdata-gmacko");

    await mkdir(path.join(sourceStateDir, "secrets"), { recursive: true });
    await mkdir(path.join(sourceStateDir, "logs"), { recursive: true });
    await writeFile(path.join(sourceStateDir, "state.sqlite"), "db");
    await writeFile(path.join(sourceStateDir, "settings.json"), "settings");
    await writeFile(path.join(sourceStateDir, "secrets", "session-signing-key"), "secret");
    await writeFile(path.join(sourceStateDir, "logs", "server.log"), "noise");

    const result = await syncT3State({ sourceStateDir, targetStateDir });

    expect(result.copiedFiles.toSorted()).toEqual([
      "secrets/session-signing-key",
      "settings.json",
      "state.sqlite",
    ]);
    expect(await readFile(path.join(targetStateDir, "state.sqlite"), "utf8")).toBe("db");
    expect(
      await readFile(path.join(targetStateDir, "secrets", "session-signing-key"), "utf8"),
    ).toBe("secret");
    await expect(
      readFile(path.join(targetStateDir, "logs", "server.log"), "utf8"),
    ).rejects.toThrow();
  });

  it("replaces stale SQLite sidecar files when syncing the database", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "t3-state-sync-sqlite-"));
    const sourceStateDir = path.join(tempDir, "source", "userdata");
    const targetStateDir = path.join(tempDir, "target", "userdata-gmacko");

    await mkdir(sourceStateDir, { recursive: true });
    await mkdir(targetStateDir, { recursive: true });
    await writeFile(path.join(sourceStateDir, "state.sqlite"), "source-db");
    await writeFile(path.join(sourceStateDir, "state.sqlite-wal"), "source-wal");
    await writeFile(path.join(targetStateDir, "state.sqlite"), "target-db");
    await writeFile(path.join(targetStateDir, "state.sqlite-wal"), "target-wal");
    await writeFile(path.join(targetStateDir, "state.sqlite-shm"), "stale-target-shm");

    const result = await syncT3State({ sourceStateDir, targetStateDir });

    expect(result.copiedFiles.toSorted()).toEqual(["state.sqlite", "state.sqlite-wal"]);
    expect(await readFile(path.join(targetStateDir, "state.sqlite"), "utf8")).toBe("source-db");
    expect(await readFile(path.join(targetStateDir, "state.sqlite-wal"), "utf8")).toBe(
      "source-wal",
    );
    await expect(readFile(path.join(targetStateDir, "state.sqlite-shm"), "utf8")).rejects.toThrow();
  });

  it("preserves provider instance ids in copied model selection settings", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "t3-state-sync-provider-settings-"));
    const sourceStateDir = path.join(tempDir, "source", "userdata");
    const targetStateDir = path.join(tempDir, "target", "userdata-gmacko");
    const modelSettings = {
      defaultModelSelection: {
        instanceId: "anthropic",
        model: "claude-sonnet-4-5",
      },
    };

    await mkdir(sourceStateDir, { recursive: true });
    await writeFile(path.join(sourceStateDir, "settings.json"), JSON.stringify(modelSettings));

    await syncT3State({ sourceStateDir, targetStateDir });

    const copiedSettings = JSON.parse(
      await readFile(path.join(targetStateDir, "settings.json"), "utf8"),
    ) as typeof modelSettings & { readonly defaultModelSelection: { readonly provider?: string } };

    expect(copiedSettings.defaultModelSelection).toEqual(modelSettings.defaultModelSelection);
    expect(copiedSettings.defaultModelSelection.provider).toBeUndefined();
  });

  it("parses profile-based CLI sync arguments", () => {
    expect(parseT3StateSyncCliArgs(["--from", "stable", "--to", "gmacko"])).toEqual({
      sourceStateDir: path.join(os.homedir(), ".t3", "userdata"),
      targetStateDir: path.join(os.homedir(), ".t3-gmacko", "userdata-gmacko"),
      dryRun: false,
      includeLogs: false,
    });
  });

  it("parses explicit CLI sync paths and safety flags", () => {
    expect(
      parseT3StateSyncCliArgs([
        "--from",
        "/tmp/source-state",
        "--to",
        "/tmp/target-state",
        "--dry-run",
        "--include-logs",
      ]),
    ).toEqual({
      sourceStateDir: "/tmp/source-state",
      targetStateDir: "/tmp/target-state",
      dryRun: true,
      includeLogs: true,
    });
  });
});
