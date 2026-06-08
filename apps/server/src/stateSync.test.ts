// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vitest";

import { parseT3StateSyncCliArgs, resolveT3StateProfile, syncT3State } from "./stateSync.ts";

describe("stateSync", () => {
  it("resolves stable and gmacko state profiles to separate default homes", () => {
    const homeDir = NodePath.join(NodeOS.tmpdir(), "t3-state-sync-home");

    expect(resolveT3StateProfile("stable", { homeDir })).toEqual({
      baseDir: NodePath.join(homeDir, ".t3"),
      stateDir: NodePath.join(homeDir, ".t3", "userdata"),
    });
    expect(resolveT3StateProfile("gmacko", { homeDir })).toEqual({
      baseDir: NodePath.join(homeDir, ".t3-gmacko"),
      stateDir: NodePath.join(homeDir, ".t3-gmacko", "userdata-gmacko"),
    });
  });

  it("copies state files recursively while skipping logs by default", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-state-sync-"));
    const sourceStateDir = NodePath.join(tempDir, "source", "userdata");
    const targetStateDir = NodePath.join(tempDir, "target", "userdata-gmacko");

    await NodeFSP.mkdir(NodePath.join(sourceStateDir, "secrets"), { recursive: true });
    await NodeFSP.mkdir(NodePath.join(sourceStateDir, "logs"), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(sourceStateDir, "state.sqlite"), "db");
    await NodeFSP.writeFile(NodePath.join(sourceStateDir, "settings.json"), "settings");
    await NodeFSP.writeFile(
      NodePath.join(sourceStateDir, "secrets", "session-signing-key"),
      "secret",
    );
    await NodeFSP.writeFile(NodePath.join(sourceStateDir, "logs", "server.log"), "noise");

    const result = await syncT3State({ sourceStateDir, targetStateDir });

    expect(result.copiedFiles.toSorted()).toEqual([
      "secrets/session-signing-key",
      "settings.json",
      "state.sqlite",
    ]);
    expect(await NodeFSP.readFile(NodePath.join(targetStateDir, "state.sqlite"), "utf8")).toBe(
      "db",
    );
    expect(
      await NodeFSP.readFile(
        NodePath.join(targetStateDir, "secrets", "session-signing-key"),
        "utf8",
      ),
    ).toBe("secret");
    await expect(
      NodeFSP.readFile(NodePath.join(targetStateDir, "logs", "server.log"), "utf8"),
    ).rejects.toThrow();
  });

  it("replaces stale SQLite sidecar files when syncing the database", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-state-sync-sqlite-"));
    const sourceStateDir = NodePath.join(tempDir, "source", "userdata");
    const targetStateDir = NodePath.join(tempDir, "target", "userdata-gmacko");

    await NodeFSP.mkdir(sourceStateDir, { recursive: true });
    await NodeFSP.mkdir(targetStateDir, { recursive: true });
    await NodeFSP.writeFile(NodePath.join(sourceStateDir, "state.sqlite"), "source-db");
    await NodeFSP.writeFile(NodePath.join(sourceStateDir, "state.sqlite-wal"), "source-wal");
    await NodeFSP.writeFile(NodePath.join(targetStateDir, "state.sqlite"), "target-db");
    await NodeFSP.writeFile(NodePath.join(targetStateDir, "state.sqlite-wal"), "target-wal");
    await NodeFSP.writeFile(NodePath.join(targetStateDir, "state.sqlite-shm"), "stale-target-shm");

    const result = await syncT3State({ sourceStateDir, targetStateDir });

    expect(result.copiedFiles.toSorted()).toEqual(["state.sqlite", "state.sqlite-wal"]);
    expect(await NodeFSP.readFile(NodePath.join(targetStateDir, "state.sqlite"), "utf8")).toBe(
      "source-db",
    );
    expect(await NodeFSP.readFile(NodePath.join(targetStateDir, "state.sqlite-wal"), "utf8")).toBe(
      "source-wal",
    );
    await expect(
      NodeFSP.readFile(NodePath.join(targetStateDir, "state.sqlite-shm"), "utf8"),
    ).rejects.toThrow();
  });

  it("preserves provider instance ids in copied model selection settings", async () => {
    const tempDir = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "t3-state-sync-provider-settings-"),
    );
    const sourceStateDir = NodePath.join(tempDir, "source", "userdata");
    const targetStateDir = NodePath.join(tempDir, "target", "userdata-gmacko");
    const modelSettings = {
      defaultModelSelection: {
        instanceId: "anthropic",
        model: "claude-sonnet-4-5",
      },
    };

    await NodeFSP.mkdir(sourceStateDir, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(sourceStateDir, "settings.json"),
      JSON.stringify(modelSettings),
    );

    await syncT3State({ sourceStateDir, targetStateDir });

    const copiedSettings = JSON.parse(
      await NodeFSP.readFile(NodePath.join(targetStateDir, "settings.json"), "utf8"),
    ) as typeof modelSettings & { readonly defaultModelSelection: { readonly provider?: string } };

    expect(copiedSettings.defaultModelSelection).toEqual(modelSettings.defaultModelSelection);
    expect(copiedSettings.defaultModelSelection.provider).toBeUndefined();
  });

  it("parses profile-based CLI sync arguments", () => {
    expect(parseT3StateSyncCliArgs(["--from", "stable", "--to", "gmacko"])).toEqual({
      sourceStateDir: NodePath.join(NodeOS.homedir(), ".t3", "userdata"),
      targetStateDir: NodePath.join(NodeOS.homedir(), ".t3-gmacko", "userdata-gmacko"),
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
