// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ReverseInvestigationStore } from "./InvestigationStore.ts";

let directory = "";
let root = "";
let store: ReverseInvestigationStore;

beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-reverse-"));
  root = NodePath.join(directory, "workspace");
  await NodeFSP.mkdir(root, { recursive: true });
  store = new ReverseInvestigationStore(NodePath.join(directory, "state"));
});
afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});

describe("reverse investigation persistence", () => {
  it("imports and hashes immutable bytes while remaining idempotent", async () => {
    await NodeFSP.writeFile(
      NodePath.join(root, "fixture.bin"),
      Buffer.from(
        "hello WORLD" + String.fromCharCode(0) + "serial=115200" + String.fromCharCode(0),
      ),
    );
    const input = {
      projectId: "p1",
      environmentId: "env1",
      workspaceRoot: root,
      relativePath: "fixture.bin",
    };
    const first = await store.importFile(input);
    const again = await store.importFile(input);
    expect(first.investigation.id).toBe(again.investigation.id);
    expect(first.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await store.list("p1")).investigations).toHaveLength(1);
    expect((await store.list("p2")).investigations).toHaveLength(0);
    const recovered = new ReverseInvestigationStore(NodePath.join(directory, "state"));
    expect((await recovered.list("p1")).investigations[0]?.id).toBe(first.investigation.id);
    expect(
      (await recovered.strings("p1", first.investigation.id)).strings.map((x) => x.value),
    ).toContain("serial=115200");
  });

  it("bounds each extracted string and keeps its file offset", async () => {
    await NodeFSP.writeFile(
      NodePath.join(root, "long.bin"),
      Buffer.concat([Buffer.from([0, 0]), Buffer.from("A".repeat(2000)), Buffer.from([0])]),
    );
    const { investigation } = await store.importFile({
      projectId: "p1",
      environmentId: "env1",
      workspaceRoot: root,
      relativePath: "long.bin",
    });
    const { strings } = await store.strings("p1", investigation.id);
    expect(strings).toEqual([{ offset: 2, value: "A".repeat(512) }]);
  });

  it("refuses a named pipe instead of waiting for a writer", async () => {
    NodeChildProcess.execFileSync("mkfifo", [NodePath.join(root, "pipe.bin")]);
    await expect(
      store.importFile({
        projectId: "p1",
        environmentId: "env1",
        workspaceRoot: root,
        relativePath: "pipe.bin",
      }),
    ).rejects.toMatchObject({ reason: "invalid_file" });
  });

  it("rejects paths escaping the workspace, including symlink traversal", async () => {
    await NodeFSP.writeFile(NodePath.join(directory, "outside.bin"), "secret");
    await NodeFSP.symlink(NodePath.join(directory, "outside.bin"), NodePath.join(root, "link.bin"));
    const base = { projectId: "p1", environmentId: "env1", workspaceRoot: root };
    await expect(store.importFile({ ...base, relativePath: "../outside.bin" })).rejects.toThrow();
    await expect(store.importFile({ ...base, relativePath: "link.bin" })).rejects.toThrow();
  });

  it("updates metadata without changing firmware bytes", async () => {
    await NodeFSP.writeFile(NodePath.join(root, "app.elf"), "test firmware");
    const first = await store.importFile({
      projectId: "p1",
      environmentId: "env1",
      workspaceRoot: root,
      relativePath: "app.elf",
    });
    const linked = await store.link("p1", first.investigation.id, {
      veritasProjectId: "vp1",
      boardRevisionId: "br1",
    });
    expect(linked.boardRevisionId).toBe("br1");
    expect((await store.list("p1")).artifacts[0]?.sha256).toBe(first.artifact.sha256);
  });

  it("clears a link with null and leaves omitted fields alone", async () => {
    await NodeFSP.writeFile(NodePath.join(root, "app.elf"), "test firmware");
    const { investigation } = await store.importFile({
      projectId: "p1",
      environmentId: "env1",
      workspaceRoot: root,
      relativePath: "app.elf",
    });
    await store.link("p1", investigation.id, { veritasProjectId: "vp1", boardRevisionId: "br1" });
    const cleared = await store.link("p1", investigation.id, { boardRevisionId: null });
    expect(cleared.veritasProjectId).toBe("vp1");
    expect(cleared.boardRevisionId).toBeUndefined();
  });

  it("deletes investigations and only collects firmware nobody references", async () => {
    await NodeFSP.writeFile(NodePath.join(root, "shared.bin"), "shared firmware");
    const base = { environmentId: "env1", workspaceRoot: root, relativePath: "shared.bin" };
    const one = await store.importFile({ ...base, projectId: "p1" });
    const two = await store.importFile({ ...base, projectId: "p2" });
    const bytes = NodePath.join(directory, "state", "reverse", "artifacts", one.artifact.sha256);
    // Older than the grace period that protects imports in flight.
    const old = (await NodeFSP.stat(bytes)).mtimeMs / 1000 - 2 * 60 * 60;
    await NodeFSP.utimes(bytes, old, old);

    await store.remove("p1", one.investigation.id);
    expect((await store.list("p1")).investigations).toHaveLength(0);
    await expect(NodeFSP.stat(bytes)).resolves.toBeDefined();

    await store.remove("p2", two.investigation.id);
    await expect(NodeFSP.stat(bytes)).rejects.toThrow();
    await expect(store.remove("p2", two.investigation.id)).rejects.toMatchObject({
      reason: "not_found",
    });
  });
});
