import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { GhidraSessionPool } from "../apps/server/src/reverse/GhidraSession.ts";
import { runBoundedTool } from "../apps/server/src/reverse/ToolRunner.ts";
if (!process.env.GHIDRA_INSTALL_DIR)
  throw new Error(
    "GHIDRA_INSTALL_DIR is required; this is a live integration test, not a mocked pass",
  );
process.env.T3_REVERSE_GHIDRA_SCRIPTS = NodePath.resolve("apps/server/src/reverse/scripts");
// CI creates this trusted fixture itself. Production MUST configure a real isolated launcher.
if (process.env.CI === "true") process.env.T3_REVERSE_SANDBOX_COMMAND = '["/usr/bin/env"]';
const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "reverse-ghidra-"));
const pool = new GhidraSessionPool(NodePath.join(root, "projects"));
try {
  const source = NodePath.join(root, "fixture.c"),
    binary = NodePath.join(root, "fixture");
  await NodeFSP.writeFile(
    source,
    "__attribute__((noinline)) int fixture_fn(int x){return x*3+7;} int main(void){return fixture_fn(2);}",
  );
  const build = await runBoundedTool({
    executable: "gcc",
    args: ["-O0", "-g", "-fno-pie", "-no-pie", source, "-o", binary],
    cwd: root,
  });
  NodeAssert.equal(build.exitCode, 0, build.stderr);
  const digest = NodeCrypto.createHash("sha256")
    .update(await NodeFSP.readFile(binary))
    .digest("hex");
  const list = await pool.execute("test-project", binary, digest);
  const fn = list.functions.find((row) => row.name === "fixture_fn");
  NodeAssert.ok(fn, "Ghidra recovered the fixture function");
  const detail = await pool.execute("test-project", binary, digest, {
    action: "function",
    address: fn.address,
  });
  NodeAssert.ok(detail.functions[0]?.pseudocode.includes("fixture_fn"));
  NodeAssert.ok(detail.functions[0]?.instructions.length);
  const prints = await pool.execute("test-project", binary, digest, { action: "fingerprints" });
  const print = prints.fingerprints?.find((row) => row.name === "fixture_fn");
  NodeAssert.ok(print && print.instructions > 0, "Ghidra fingerprinted the fixture function");
  NodeAssert.match(print.shape, /^[0-9a-f]{16}$/);
  const renamed = await pool.execute("test-project", binary, digest, {
    action: "rename",
    address: fn.address,
    expectedName: fn.name,
    name: "reviewed_fixture",
  });
  NodeAssert.equal(renamed.functions[0]?.name, "reviewed_fixture");
  await NodeAssert.rejects(
    pool.execute("test-project", binary, digest, {
      action: "rename",
      address: fn.address,
      expectedName: fn.name,
      name: "stale_edit",
    }),
    /changed/,
  );
  await pool.execute("test-project", binary, digest, { action: "close" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const reopened = await pool.execute("test-project", binary, digest, {
    action: "function",
    address: fn.address,
  });
  NodeAssert.equal(reopened.functions[0]?.name, "reviewed_fixture");
  console.log(
    "PASS: real Ghidra import, persistent decompilation, fingerprints, rename conflict and save/reopen",
  );
} finally {
  pool.dispose();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await NodeFSP.rm(root, { recursive: true, force: true });
}
