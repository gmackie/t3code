// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { inspectToolchain } from "./Toolchain.ts";

let root = "";
beforeEach(async () => {
  root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-toolchain-"));
});
afterEach(async () => {
  await NodeFSP.rm(root, { recursive: true, force: true });
});

const executable = async (name: string) => {
  const path = NodePath.join(root, name);
  await NodeFSP.writeFile(path, "#!/bin/sh\n", { mode: 0o755 });
  return path;
};

describe("reverse toolchain doctor", () => {
  it("reports what is ready, missing or misconfigured without running anything", async () => {
    const launcher = await executable("sandbox");
    await executable("binwalk");
    await NodeFSP.writeFile(NodePath.join(root, "unblob"), "not executable", { mode: 0o644 });
    const { tools } = await inspectToolchain({
      PATH: root,
      T3_REVERSE_SANDBOX_COMMAND: JSON.stringify([launcher, "--isolate"]),
      GHIDRA_INSTALL_DIR: "relative/ghidra",
    });
    const status = Object.fromEntries(tools.map((tool) => [tool.id, tool.status]));
    expect(status).toMatchObject({
      sandbox: "ready",
      binwalk: "ready",
      unblob: "missing",
      ghidra: "missing",
      java: "missing",
      qemu: "missing",
    });
    expect(tools.find((tool) => tool.id === "qemu")?.requiredFor).toEqual(["emulate"]);
  });

  it("flags a sandbox launcher that is not an absolute executable", async () => {
    const { tools } = await inspectToolchain({
      PATH: root,
      T3_REVERSE_SANDBOX_COMMAND: JSON.stringify(["bwrap"]),
    });
    expect(tools.find((tool) => tool.id === "sandbox")).toMatchObject({
      status: "misconfigured",
    });
  });
});
