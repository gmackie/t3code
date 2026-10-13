// @effect-diagnostics nodeBuiltinImport:off - analysis subprocesses are environment-owned.
import * as Fs from "node:fs/promises";
import * as Path from "node:path";
import { ReverseStoreError } from "@t3tools/contracts";
import { runBoundedTool, type ToolResult } from "./ToolRunner.ts";
import type { ReverseInvestigationStore } from "./InvestigationStore.ts";

export type AnalysisKind = "ghidra" | "binwalk" | "gadgets";
export interface GhidraFunction {
  address: string;
  name: string;
  pseudocode: string;
  instructions: readonly { address: string; text: string }[];
}
export interface CandidateGadget {
  address: string;
  instructions: string;
  kind: "rop" | "jop" | "cop" | "other";
}

export interface AnalysisResult {
  kind: AnalysisKind;
  output: string;
  toolVersion?: string;
  functions?: GhidraFunction[];
  gadgets?: CandidateGadget[];
  truncated: boolean;
}

const MAX_RESULTS = 1_000;
const fail = (message: string) => new ReverseStoreError({ reason: "unavailable", message });

export function parseGadgets(stdout: string): CandidateGadget[] {
  const result: CandidateGadget[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /^\s*(0x[0-9a-f]+)\s*:\s*(.+?)\s*$/iu.exec(line);
    if (!match) continue;
    const instructions = match[2]!;
    const tail = instructions.split(";").at(-1)?.trim().toLowerCase() ?? "";
    const kind = /^(ret|pop.*pc\b|bx\s+lr\b)/u.test(tail)
      ? "rop" : /^(jmp|br\s+|bx\s+(?!lr\b))/u.test(tail)
        ? "jop" : /^call\b/u.test(tail) ? "cop" : "other";
    result.push({ address: match[1]!, instructions, kind });
    if (result.length >= MAX_RESULTS) break;
  }
  return result;
}

async function runChecked(tool: string, args: string[], cwd: string, timeoutMs = 90_000): Promise<ToolResult> {
  let result: ToolResult;
  try {
    result = await runBoundedTool({ executable: tool, args, cwd, timeoutMs });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw fail(`Install ${Path.basename(tool)} on the analysis host to enable this analyzer.`);
    throw new ReverseStoreError({ reason: "operation_failed", message: String(error) });
  }
  if (result.exitCode !== 0)
    throw new ReverseStoreError({
      reason: "operation_failed",
      message: `${Path.basename(tool)} failed (exit ${result.exitCode}): ${result.stderr.slice(0, 1024)}`,
    });
  return result;
}

export class ReverseAnalysisService {
  constructor(
    private readonly stateDir: string,
    private readonly store: ReverseInvestigationStore,
  ) {}

  async run(input: {
    projectId: string;
    investigationId: string;
    kind: AnalysisKind;
    rawArch?: "x86" | "arm" | "arm64" | "mips" | "riscv";
    rawMode?: "32" | "64" | "arm" | "thumb";
  }): Promise<AnalysisResult> {
    const { artifact, path } = await this.store.getArtifact(input.projectId, input.investigationId);
    const dir = Path.join(this.stateDir, "reverse", "analysis", artifact.sha256);
    await Fs.mkdir(dir, { recursive: true });
    if (input.kind === "binwalk") {
      // Binwalk 3: -l creates a JSON scan log, without extraction or executing vendor images.
      const outputPath = Path.join(dir, "binwalk.json");
      const r = await runChecked("binwalk", ["-l", outputPath, path], dir, 90_000);
      const data = await Fs.readFile(outputPath, "utf8").catch(() => r.stdout);
      return { kind: "binwalk", output: data.slice(0, 4_000_000), truncated: r.truncated || data.length > 4_000_000 };
    }
    if (input.kind === "gadgets") {
      const args = ["--binary", path, "--depth", "6", "--nosys"];
      if (input.rawArch) args.push("--rawArch", input.rawArch);
      if (input.rawMode) args.push("--rawMode", input.rawMode);
      const r = await runChecked("ROPgadget", args, dir, 90_000);
      const gadgets = parseGadgets(r.stdout);
      return {
        kind: "gadgets", gadgets,
        output: `${gadgets.length} candidate gadgets (not evidence of exploitability).`,
        truncated: r.truncated || gadgets.length >= MAX_RESULTS,
      };
    }
    // Transitional headless exporter: persistent project and cached result; the live
    // JVM service replaces this adapter without changing the client contract.
    const installDir = process.env.GHIDRA_INSTALL_DIR;
    const scriptDir = process.env.T3_REVERSE_GHIDRA_SCRIPTS;
    if (!installDir || !scriptDir)
      throw fail("Configure GHIDRA_INSTALL_DIR and T3_REVERSE_GHIDRA_SCRIPTS to enable Ghidra analysis.");
    const executable = Path.join(installDir, "support", process.platform === "win32" ? "analyzeHeadless.bat" : "analyzeHeadless");
    const outputPath = Path.join(dir, "ghidra-analysis.json");
    const projectDirectory = Path.join(dir, "ghidra-project");
    await Fs.mkdir(projectDirectory, { recursive: true });
    const r = await runChecked(executable, [
      projectDirectory, `Firmware_${artifact.sha256.slice(0, 16)}`,
      "-import", path,
      "-analysisTimeoutPerFile", "60",
      "-scriptPath", scriptDir,
      "-postScript", "ReverseExport.java", outputPath,
    ], dir, 150_000);
    const raw = JSON.parse(await Fs.readFile(outputPath, "utf8")) as { functions?: GhidraFunction[] };
    const functions = (raw.functions ?? []).slice(0, 500);
    return {
      kind: "ghidra", functions,
      output: `Ghidra reported ${functions.length} functions.`,
      truncated: r.truncated || (raw.functions?.length ?? 0) > 500,
    };
  }

  async emulate(input: { projectId: string; investigationId: string; machine: "lm3s6965evb" | "mps2-an385" }) {
    const { path } = await this.store.getArtifact(input.projectId, input.investigationId);
    const dir = Path.dirname(path);
    const result = await runChecked("qemu-system-arm", [
      "-M", input.machine, "-kernel", path, "-nographic",
      "-nic", "none", "-monitor", "none", "-no-reboot",
    ], dir, 5_000).catch((error) => {
      // A short emulation window is expected to time out: report it as an incomplete
      // observation instead of claiming a successful boot/verification.
      if (String(error).includes("timeout")) return null;
      throw error;
    });
    if (result === null) return {
      source: "qemu" as const, outcome: "inconclusive" as const,
      output: "QEMU was terminated after a five-second observation window. No verification claim.",
    };
    return {
      source: "qemu" as const,
      outcome: result.exitCode === 0 ? "inconclusive" as const : "error" as const,
      output: (result.stdout + result.stderr).slice(0, 32_768),
    };
  }
}
