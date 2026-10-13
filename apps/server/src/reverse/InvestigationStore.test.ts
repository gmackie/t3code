// @effect-diagnostics nodeBuiltinImport:off
import * as Fs from "node:fs/promises";
import * as Os from "node:os";
import * as Path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ReverseInvestigationStore } from "./InvestigationStore.ts";

let directory = "";
let root = "";
let store: ReverseInvestigationStore;

beforeEach(async () => {
  directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), "t3-reverse-"));
  root = Path.join(directory, "workspace");
  await Fs.mkdir(root, { recursive: true });
  store = new ReverseInvestigationStore(Path.join(directory, "state"));
});
afterEach(async () => {
  await Fs.rm(directory, { recursive: true, force: true });
});

describe("reverse investigation persistence", () => {
  it("imports and hashes immutable bytes while remaining idempotent", async () => {
    await Fs.writeFile(Path.join(root, "fixture.bin"), Buffer.from("hello WORLD" + String.fromCharCode(0) + "serial=115200" + String.fromCharCode(0)));
    const input = { projectId: "p1", environmentId: "env1", workspaceRoot: root, relativePath: "fixture.bin" };
    const first = await store.importFile(input);
    const again = await store.importFile(input);
    expect(first.investigation.id).toBe(again.investigation.id);
    expect(first.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await store.list("p1")).investigations).toHaveLength(1);
    expect((await store.list("p2")).investigations).toHaveLength(0);
    const recovered = new ReverseInvestigationStore(Path.join(directory, "state"));
    expect((await recovered.list("p1")).investigations[0]?.id).toBe(first.investigation.id);
    expect((await recovered.strings("p1", first.investigation.id)).strings.map(x=>x.value)).toContain("serial=115200");
  });

  it("rejects paths escaping the workspace, including symlink traversal", async () => {
    await Fs.writeFile(Path.join(directory, "outside.bin"), "secret");
    await Fs.symlink(Path.join(directory, "outside.bin"), Path.join(root, "link.bin"));
    const base = { projectId: "p1", environmentId: "env1", workspaceRoot: root };
    await expect(store.importFile({ ...base, relativePath: "../outside.bin" })).rejects.toThrow();
    await expect(store.importFile({ ...base, relativePath: "link.bin" })).rejects.toThrow();
  });

  it("updates metadata without changing firmware bytes", async () => {
    await Fs.writeFile(Path.join(root, "app.elf"), "test firmware");
    const first = await store.importFile({
      projectId: "p1", environmentId: "env1", workspaceRoot: root, relativePath: "app.elf",
    });
    const linked = await store.link("p1", first.investigation.id, { veritasProjectId: "vp1", boardRevisionId: "br1" });
    expect(linked.boardRevisionId).toBe("br1");
    expect((await store.list("p1")).artifacts[0]?.sha256).toBe(first.artifact.sha256);
  });
});
