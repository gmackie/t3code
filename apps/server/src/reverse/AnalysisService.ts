// @effect-diagnostics nodeBuiltinImport:off globalDate:off - analysis subprocesses are environment-owned promise code.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { ReverseStoreError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { runBoundedTool, type ToolResult } from "./ToolRunner.ts";
import type { ReverseInvestigationStore } from "./InvestigationStore.ts";
import { ghidraSessions, type GhidraFunction, type GhidraOperation } from "./GhidraSession.ts";
import { parseGadgets, type CandidateGadget } from "./Gadgets.ts";
import { inspectBinary } from "./BinaryLayout.ts";

const isReverseStoreError = Schema.is(ReverseStoreError);
export { parseGadgets } from "./Gadgets.ts";
export type { GhidraFunction, CandidateGadget };
export type AnalysisKind = "ghidra" | "binwalk" | "gadgets" | "unblob" | "rea" | "posture";
export interface AnalysisResult {
  kind: AnalysisKind;
  output: string;
  toolVersion?: string;
  functions?: GhidraFunction[];
  gadgets?: CandidateGadget[];
  extracted?: { path: string; bytes: number; sha256?: string }[];
  truncated: boolean;
  receiptId?: string;
  nextCursor?: number;
}
export interface AnalysisInput {
  projectId: string;
  investigationId: string;
  kind: AnalysisKind;
  rawArch?: "x86" | "arm" | "arm64" | "mips" | "riscv" | undefined;
  rawMode?: "32" | "64" | "arm" | "thumb" | undefined;
  rawEndian?: "little" | "big" | undefined;
  ghidra?: GhidraOperation | undefined;
}
const failure = (message: string) => new ReverseStoreError({ reason: "operation_failed", message });
async function boundedText(path: string): Promise<string> {
  const file = await NodeFSP.open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
      throw new Error("Analysis report exceeded 4 MiB");
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}
async function checked(
  tool: string,
  args: string[],
  cwd: string,
  timeoutMs = 90000,
  // Listing tools may stop at the output cap; their partial output is still usable.
  options: { allowTruncated?: boolean } = {},
): Promise<ToolResult> {
  const result = await runBoundedTool({ executable: tool, args, cwd, timeoutMs, sandbox: true });
  const cut = result.truncated && options.allowTruncated === true;
  if (result.timedOut || (result.truncated && !cut) || (!cut && result.exitCode !== 0))
    throw failure(
      `${NodePath.basename(tool)} did not complete: ${result.timedOut ? "timeout" : result.truncated ? "output limit" : `exit ${result.exitCode}`} ${result.stderr.slice(-2048)}`,
    );
  return result;
}
/** Tool completion is not validation. Receipts retain versions, parameters and immutable identity. */
export class ReverseAnalysisService {
  private readonly stateDir: string;
  private readonly store: ReverseInvestigationStore;
  constructor(stateDir: string, store: ReverseInvestigationStore) {
    this.stateDir = stateDir;
    this.store = store;
  }
  async run(input: AnalysisInput): Promise<AnalysisResult> {
    const { artifact, path } = await this.store.getArtifact(input.projectId, input.investigationId);
    // Browsing a Ghidra program is a read; only edits leave a receipt.
    const ghidraAction = input.ghidra?.action ?? "list";
    if (input.kind === "ghidra" && ["list", "function", "close"].includes(ghidraAction)) {
      const response = await ghidraSessions(this.stateDir)
        .execute(input.projectId, path, artifact.sha256, input.ghidra)
        .catch((error: unknown) => {
          throw isReverseStoreError(error) ? error : failure(String(error));
        });
      return {
        kind: "ghidra",
        ...response,
        output: `${response.functions.length} functions from the persistent Ghidra session.`,
      };
    }
    const receiptId = NodeCrypto.randomUUID(),
      owner = NodeCrypto.createHash("sha256").update(input.projectId).digest("hex");
    const dir = NodePath.join(this.stateDir, "reverse", "analysis", owner, receiptId);
    await NodeFSP.mkdir(dir, { recursive: true, mode: 0o700 });
    let result: AnalysisResult;
    try {
      if (input.kind === "ghidra") {
        const response = await ghidraSessions(this.stateDir).execute(
          input.projectId,
          path,
          artifact.sha256,
          input.ghidra,
        );
        result = {
          kind: "ghidra",
          ...response,
          output: `${response.functions.length} functions from the persistent Ghidra session.`,
        };
      } else if (input.kind === "posture") {
        if (artifact.sizeBytes > 64 * 1024 * 1024)
          throw new Error("Posture reader is bounded to 64 MiB; use Ghidra for larger artifacts");
        result = {
          kind: "posture",
          output: JSON.stringify(inspectBinary(await NodeFSP.readFile(path)), null, 2),
          toolVersion: "t3-elf-layout/1",
          truncated: false,
        };
      } else if (input.kind === "binwalk") {
        const report = NodePath.join(dir, "binwalk.json"),
          run = await checked("binwalk", ["--log", report, path], dir);
        const output = await boundedText(report).catch((error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return run.stdout;
          throw error;
        });
        result = { kind: "binwalk", output, truncated: false };
      } else if (input.kind === "gadgets") {
        const args = ["--binary", path, "--depth", "10", "--nosys"];
        if (Boolean(input.rawArch) !== Boolean(input.rawMode))
          throw new Error("Raw gadget analysis requires both architecture and mode");
        if (input.rawArch && input.rawMode) {
          const modes: Record<string, readonly string[]> = {
            x86: ["32", "64"],
            arm: ["arm", "thumb"],
            arm64: ["arm"],
            mips: ["32", "64"],
            riscv: ["64"],
          };
          if (!modes[input.rawArch]?.includes(input.rawMode))
            throw new Error("Unsupported architecture/mode pair");
          args.push(
            "--rawArch",
            input.rawArch,
            "--rawMode",
            input.rawMode,
            "--rawEndian",
            input.rawEndian ?? "little",
          );
        }
        const run = await checked("ROPgadget", args, dir, 90000, { allowTruncated: true }),
          // A capped run ends mid-line; that last line is not a gadget.
          gadgets = parseGadgets(
            run.truncated ? run.stdout.slice(0, run.stdout.lastIndexOf("\n") + 1) : run.stdout,
          );
        result = {
          kind: "gadgets",
          gadgets,
          output: `${gadgets.length} syntactic candidates. ${input.rawArch ? "Addresses are raw file offsets; execution permissions are unknown." : "Addresses are image virtual addresses reported by ROPgadget."} No reachability or exploitability claim.`,
          truncated: run.truncated || gadgets.length >= 1000,
        };
      } else if (input.kind === "rea") {
        const run = await checked("rea", ["analyze", path, "--json"], dir, 120000);
        result = { kind: "rea", output: run.stdout, truncated: false };
      } else if (input.kind === "unblob") {
        const output = NodePath.join(dir, "extracted");
        await checked(
          "unblob",
          [
            "--extract-dir",
            output,
            "--depth",
            "3",
            "--process-num",
            "1",
            "--report",
            NodePath.join(dir, "unblob.json"),
            path,
          ],
          dir,
          120000,
        );
        const extracted: { path: string; bytes: number; sha256: string }[] = [];
        let total = 0;
        const visit = async (folder: string, depth: number): Promise<void> => {
          if (depth > 8) throw new Error("Extraction tree exceeds depth limit");
          for (const item of await NodeFSP.readdir(folder, { withFileTypes: true })) {
            if (item.isSymbolicLink()) continue;
            const full = NodePath.join(folder, item.name);
            if (item.isDirectory()) await visit(full, depth + 1);
            else if (item.isFile()) {
              const stat = await NodeFSP.lstat(full);
              if (stat.nlink !== 1 || !stat.isFile())
                throw new Error("Extraction produced an unsafe hardlink or special file");
              total += stat.size;
              if (extracted.length >= 500 || total > 256 * 1024 * 1024)
                throw new Error(
                  "Extraction exceeded manifest budget; worker storage must also be quota-limited",
                );
              const handle = await NodeFSP.open(full, "r"),
                hash = NodeCrypto.createHash("sha256");
              try {
                for await (const chunk of handle.createReadStream()) hash.update(chunk);
              } finally {
                await handle.close().catch(() => undefined);
              }
              extracted.push({
                path: NodePath.relative(output, full),
                bytes: stat.size,
                sha256: hash.digest("hex"),
              });
            }
          }
        };
        await visit(output, 0);
        result = {
          kind: "unblob",
          extracted,
          output: `${extracted.length} files retained in analysis receipt ${receiptId}; original firmware unchanged.`,
          truncated: false,
        };
      } else throw new Error("Unsupported analyzer");
      if (!result.toolVersion) {
        const name = input.kind === "gadgets" ? "ROPgadget" : input.kind;
        const version = await runBoundedTool({
          executable: name,
          args: ["--version"],
          cwd: dir,
          timeoutMs: 5000,
          maxOutputBytes: 4096,
          sandbox: true,
        }).catch(() => null);
        result.toolVersion =
          version?.exitCode === 0
            ? (version.stdout || version.stderr).trim().slice(0, 256)
            : "unreported";
      }
      result.receiptId = receiptId;
      await NodeFSP.writeFile(
        NodePath.join(dir, "receipt.json"),
        JSON.stringify({
          schemaVersion: 1,
          id: receiptId,
          source: "static",
          artifactSha256: artifact.sha256,
          parameters: input,
          result,
          recordedAt: new Date().toISOString(),
          releaseEvidence: false,
        }),
        { flag: "wx", mode: 0o600 },
      );
      return result;
    } catch (error) {
      // A failed run keeps only its failure record, never partial extraction output.
      for (const entry of await NodeFSP.readdir(dir).catch(() => []))
        await NodeFSP.rm(NodePath.join(dir, entry), { recursive: true, force: true }).catch(
          () => undefined,
        );
      await NodeFSP.writeFile(
        NodePath.join(dir, "failure.json"),
        JSON.stringify({
          id: receiptId,
          artifactSha256: artifact.sha256,
          parameters: input,
          error: String(error),
          releaseEvidence: false,
        }),
        { flag: "wx", mode: 0o600 },
      ).catch(() => undefined);
      throw isReverseStoreError(error) ? error : failure(String(error));
    }
  }
  async emulate(input: {
    projectId: string;
    investigationId: string;
    machine: "lm3s6965evb" | "mps2-an385";
  }) {
    if (!["lm3s6965evb", "mps2-an385"].includes(input.machine))
      throw failure("Unsupported QEMU machine");
    const { artifact, path } = await this.store.getArtifact(input.projectId, input.investigationId);
    const receiptId = NodeCrypto.randomUUID(),
      dir = NodePath.join(this.stateDir, "reverse", "emulation", receiptId);
    await NodeFSP.mkdir(dir, { recursive: true, mode: 0o700 });
    const run = await runBoundedTool({
      executable: "qemu-system-arm",
      args: [
        "-M",
        input.machine,
        "-kernel",
        path,
        "-display",
        "none",
        "-serial",
        "stdio",
        "-nic",
        "none",
        "-monitor",
        "none",
        "-no-reboot",
      ],
      cwd: dir,
      timeoutMs: 5000,
      sandbox: true,
    });
    const result = {
      source: "qemu" as const,
      outcome: run.timedOut || run.exitCode === 0 ? ("inconclusive" as const) : ("error" as const),
      output: `${run.stdout}${run.stderr}`.slice(0, 32768),
      receiptId,
      timedOut: run.timedOut,
    };
    await NodeFSP.writeFile(
      NodePath.join(dir, "receipt.json"),
      JSON.stringify({
        ...result,
        artifactSha256: artifact.sha256,
        machine: input.machine,
        raw: run,
        recordedAt: new Date().toISOString(),
        releaseEvidence: false,
      }),
      { flag: "wx", mode: 0o600 },
    );
    return result;
  }
}
