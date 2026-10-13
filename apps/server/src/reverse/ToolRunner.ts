// @effect-diagnostics nodeBuiltinImport:off - native analyzers run only on the environment host.
import { spawn } from "node:child_process";

/** No shell invocation, bounded output and time, with cancellation on failure. */
export interface ToolResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export function runBoundedTool(input: {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}): Promise<ToolResult> {
  const timeoutMs = Math.max(100, Math.min(input.timeoutMs ?? 60_000, 180_000));
  const outputCap = Math.max(1024, Math.min(input.maxOutputBytes ?? 4 * 1024 * 1024, 16 * 1024 * 1024));
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    let stdout = "", stderr = "", total = 0, truncated = false, timedOut = false, finished = false;
    const capture = (buffer: Buffer, stream: "stdout" | "stderr") => {
      if (finished) return;
      const limit = Math.max(0, outputCap - total);
      const text = buffer.subarray(0, limit).toString("utf8");
      total += buffer.length;
      if (stream === "stdout") stdout += text; else stderr += text;
      if (buffer.length > limit) { truncated = true; child.kill("SIGKILL"); }
    };
    child.stdout?.on("data", (chunk: Buffer) => capture(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => capture(chunk, "stderr"));
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    const onAbort = () => child.kill("SIGKILL");
    if (input.signal?.aborted) onAbort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      finished = true;
    };
    child.once("error", (error) => { if (finished) return; cleanup(); reject(error); });
    child.once("close", (code) => {
      if (finished) return;
      cleanup();
      if (timedOut) reject(new Error(`Tool exceeded ${timeoutMs} ms timeout`));
      else if (input.signal?.aborted) reject(new Error("Tool execution was cancelled"));
      else resolve({ exitCode: code, stdout, stderr, truncated });
    });
  });
}
