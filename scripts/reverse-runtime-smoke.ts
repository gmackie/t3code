import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { runBoundedTool, toolEnvironment } from "../apps/server/src/reverse/ToolRunner.ts";
import { JsonLineProcess } from "../apps/server/src/reverse/JsonLineProcess.ts";
import { parseGadgets } from "../apps/server/src/reverse/Gadgets.ts";
import { inspectBinary, addressToFileOffset } from "../apps/server/src/reverse/BinaryLayout.ts";
const cwd = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "reverse-runtime-"));
NodeTest.after(async () => NodeFSP.rm(cwd, { recursive: true, force: true }));
const run = (code: string, options = {}) =>
  runBoundedTool({ executable: process.execPath, args: ["-e", code], cwd, ...options });
NodeTest.test("native environment excludes credentials", () => {
  NodeAssert.deepEqual(
    toolEnvironment(cwd, {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "secret",
      NODE_OPTIONS: "--inspect",
      SSH_AUTH_SOCK: "/secret",
    }),
    { HOME: cwd, USERPROFILE: cwd, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/bin" },
  );
});
NodeTest.test("timeout retains observations", async () => {
  const result = await run("console.log('boot observed');setInterval(()=>{},100)", {
    timeoutMs: 300,
  });
  NodeAssert.equal(result.timedOut, true);
  NodeAssert.match(result.stdout, /boot observed/);
});
NodeTest.test("combined output is bounded", async () => {
  const result = await run("process.stdout.write('X'.repeat(100000))", { maxOutputBytes: 1024 });
  NodeAssert.equal(result.truncated, true);
  NodeAssert.equal(result.stdout.length, 1024);
});
NodeTest.test("abort before spawn", async () => {
  const control = new AbortController();
  control.abort(new Error("cancelled"));
  await NodeAssert.rejects(run("process.exit(99)", { signal: control.signal }), /cancelled/);
});
NodeTest.test("isolation is required", async () => {
  const old = process.env.T3_REVERSE_SANDBOX_COMMAND;
  delete process.env.T3_REVERSE_SANDBOX_COMMAND;
  try {
    await NodeAssert.rejects(run("process.exit(99)", { sandbox: true }), /sandbox_required/);
  } finally {
    if (old !== undefined) process.env.T3_REVERSE_SANDBOX_COMMAND = old;
  }
});
NodeTest.test("framed UTF-8 replies ignore startup logs", async () => {
  const code = `const rl=require('readline').createInterface({input:process.stdin});console.log('log');rl.on('line',line=>{const r=JSON.parse(line);const d=Buffer.from('@T3RE:'+JSON.stringify({id:r.id,result:{method:r.method,text:'é'}})+'\\n');process.stdout.write(d.subarray(0,d.length-4));setTimeout(()=>process.stdout.write(d.subarray(d.length-4)),5)});`;
  const bridge = new JsonLineProcess({ executable: process.execPath, args: ["-e", code], cwd });
  try {
    NodeAssert.deepEqual(await bridge.request("ping"), { method: "ping", text: "é" });
  } finally {
    bridge.close();
  }
});
NodeTest.test("timed-out mutations are not replayed", async () => {
  const bridge = new JsonLineProcess({
    executable: process.execPath,
    args: ["-e", "setInterval(()=>{},100)"],
    cwd,
  });
  await NodeAssert.rejects(bridge.request("rename", {}, 50), /No automatic retry/);
  NodeAssert.equal(bridge.isClosed(), true);
  await NodeAssert.rejects(bridge.request("rename"), /closed/);
});
NodeTest.test("queued requests are timed from when they are sent", async () => {
  // Like the Ghidra bridge, this worker answers one request at a time.
  const code = `const q=[];let busy=false;const next=()=>{if(busy||!q.length)return;busy=true;const r=q.shift();setTimeout(()=>{process.stdout.write('@T3RE:'+JSON.stringify({id:r.id,result:r.method})+'\\n');busy=false;next()},40)};require('readline').createInterface({input:process.stdin}).on('line',line=>{q.push(JSON.parse(line));next()});`;
  const bridge = new JsonLineProcess({ executable: process.execPath, args: ["-e", code], cwd });
  try {
    await bridge.request("warm", {}, 5000);
    const replies = await Promise.all(
      ["a", "b", "c"].map((method) => bridge.request(method, {}, 60)),
    );
    NodeAssert.deepEqual(replies, ["a", "b", "c"]);
    NodeAssert.equal(bridge.isClosed(), false);
  } finally {
    bridge.close();
  }
});
NodeTest.test("gadget classification includes MIPS delay slots", () => {
  const rows = parseGadgets(
    "0x100 : pop {r4, pc}\n0x200 : jr $ra ; nop\n0x300 : blr x8\n0x400 : jmp rax\n0x100 : pop {r4, pc}",
  );
  NodeAssert.deepEqual(
    rows.map((x) => x.kind),
    ["rop", "rop", "cop", "jop"],
  );
  NodeAssert.ok(rows.every((x) => x.classification === "syntactic" && x.effects === "not-modeled"));
});
NodeTest.test("raw bytes do not prove a virtual layout", () => {
  const layout = inspectBinary(Buffer.from("raw firmware"));
  NodeAssert.equal(layout.format, "raw-or-unsupported");
  NodeAssert.equal(addressToFileOffset(layout, "0x1000"), null);
});
NodeTest.test("ELF64 addresses never round through Number", () => {
  const b = Buffer.alloc(256);
  b.set([127, 69, 76, 70, 2, 1, 1]);
  b.writeUInt16LE(2, 16);
  b.writeUInt16LE(62, 18);
  b.writeBigUInt64LE(64n, 32);
  b.writeUInt16LE(56, 54);
  b.writeUInt16LE(1, 56);
  b.writeUInt32LE(1, 64);
  b.writeUInt32LE(5, 68);
  b.writeBigUInt64LE(128n, 72);
  b.writeBigUInt64LE(0xffff800000001000n, 80);
  b.writeBigUInt64LE(32n, 96);
  b.writeBigUInt64LE(64n, 104);
  const layout = inspectBinary(b);
  NodeAssert.equal(addressToFileOffset(layout, "0xffff80000000100f"), 143);
  NodeAssert.equal(addressToFileOffset(layout, "0xffff800000001030"), null);
});
