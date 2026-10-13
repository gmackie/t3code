import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBoundedTool, toolEnvironment } from "../apps/server/src/reverse/ToolRunner.ts";
import { JsonLineProcess } from "../apps/server/src/reverse/JsonLineProcess.ts";
import { parseGadgets } from "../apps/server/src/reverse/Gadgets.ts";
import { inspectBinary, addressToFileOffset } from "../apps/server/src/reverse/BinaryLayout.ts";
const cwd = await mkdtemp(join(tmpdir(), "reverse-runtime-"));
after(async () => rm(cwd, { recursive: true, force: true }));
const run = (code: string, options = {}) => runBoundedTool({ executable: process.execPath, args: ["-e", code], cwd, ...options });
test("native environment excludes credentials", () => { assert.deepEqual(toolEnvironment(cwd, { PATH: "/usr/bin", OPENAI_API_KEY: "secret", NODE_OPTIONS: "--inspect", SSH_AUTH_SOCK: "/secret" }), { HOME: cwd, USERPROFILE: cwd, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/bin" }); });
test("timeout retains observations", async () => { const result = await run("console.log('boot observed');setInterval(()=>{},100)", { timeoutMs: 300 }); assert.equal(result.timedOut,true); assert.match(result.stdout,/boot observed/); });
test("combined output is bounded", async () => { const result = await run("process.stdout.write('X'.repeat(100000))", { maxOutputBytes:1024 }); assert.equal(result.truncated,true); assert.equal(result.stdout.length,1024); });
test("abort before spawn", async () => { const control = new AbortController();control.abort(new Error("cancelled"));await assert.rejects(run("process.exit(99)",{signal:control.signal}),/cancelled/); });
test("isolation is required", async () => { const old=process.env.T3_REVERSE_SANDBOX_COMMAND;delete process.env.T3_REVERSE_SANDBOX_COMMAND;try { await assert.rejects(run("process.exit(99)",{sandbox:true}),/sandbox_required/); } finally { if(old!==undefined)process.env.T3_REVERSE_SANDBOX_COMMAND=old; } });
test("framed UTF-8 replies ignore startup logs", async () => {
 const code=`const rl=require('readline').createInterface({input:process.stdin});console.log('log');rl.on('line',line=>{const r=JSON.parse(line);const d=Buffer.from('@T3RE:'+JSON.stringify({id:r.id,result:{method:r.method,text:'é'}})+'\\n');process.stdout.write(d.subarray(0,d.length-4));setTimeout(()=>process.stdout.write(d.subarray(d.length-4)),5)});`;
 const bridge=new JsonLineProcess({executable:process.execPath,args:["-e",code],cwd});try { assert.deepEqual(await bridge.request("ping"),{method:"ping",text:"é"}); } finally { bridge.close(); }
});
test("timed-out mutations are not replayed",async()=>{const bridge=new JsonLineProcess({executable:process.execPath,args:["-e","setInterval(()=>{},100)"],cwd});await assert.rejects(bridge.request("rename",{},50),/No automatic retry/);assert.equal(bridge.isClosed(),true);await assert.rejects(bridge.request("rename"),/closed/);});
test("gadget classification includes MIPS delay slots",()=>{const rows=parseGadgets("0x100 : pop {r4, pc}\n0x200 : jr $ra ; nop\n0x300 : blr x8\n0x400 : jmp rax\n0x100 : pop {r4, pc}");assert.deepEqual(rows.map(x=>x.kind),["rop","rop","cop","jop"]);assert.ok(rows.every(x=>x.classification==="syntactic"&&x.effects==="not-modeled"));});
test("raw bytes do not prove a virtual layout",()=>{const layout=inspectBinary(Buffer.from("raw firmware"));assert.equal(layout.format,"raw-or-unsupported");assert.equal(addressToFileOffset(layout,"0x1000"),null);});
test("ELF64 addresses never round through Number",()=>{const b=Buffer.alloc(256);b.set([127,69,76,70,2,1,1]);b.writeUInt16LE(2,16);b.writeUInt16LE(62,18);b.writeBigUInt64LE(64n,32);b.writeUInt16LE(56,54);b.writeUInt16LE(1,56);b.writeUInt32LE(1,64);b.writeUInt32LE(5,68);b.writeBigUInt64LE(128n,72);b.writeBigUInt64LE(0xffff800000001000n,80);b.writeBigUInt64LE(32n,96);b.writeBigUInt64LE(64n,104);const layout=inspectBinary(b);assert.equal(addressToFileOffset(layout,"0xffff80000000100f"),143);assert.equal(addressToFileOffset(layout,"0xffff800000001030"),null);});
