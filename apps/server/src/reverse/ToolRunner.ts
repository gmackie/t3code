// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - native tools are an explicit host boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
export interface ToolResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}
export interface ToolInput {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  sandbox?: boolean;
}
/** Never give firmware parsers provider credentials, SSH sockets or NODE_OPTIONS. */
export function toolEnvironment(
  cwd: string,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    HOME: cwd,
    USERPROFILE: cwd,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "JAVA_HOME", "TMPDIR", "TEMP", "TMP"])
    if (source[key]) result[key] = source[key];
  return result;
}
export function launchTool(input: ToolInput): {
  child: NodeChildProcess.ChildProcessWithoutNullStreams;
  terminate: () => void;
} {
  input.signal?.throwIfAborted();
  let executable = input.executable,
    args = [...input.args];
  if (input.sandbox) {
    const configured = process.env.T3_REVERSE_SANDBOX_COMMAND;
    if (!configured)
      throw new Error(
        "sandbox_required: configure T3_REVERSE_SANDBOX_COMMAND as a JSON argv array for an isolated worker. No firmware tool was started.",
      );
    const wrapper: unknown = JSON.parse(configured);
    if (
      !Array.isArray(wrapper) ||
      !wrapper.length ||
      wrapper.some((x) => typeof x !== "string" || !x || x.includes("\0")) ||
      !NodePath.isAbsolute(wrapper[0])
    )
      throw new Error(
        "Invalid isolation launcher: expected a JSON argv array starting with an absolute executable path.",
      );
    executable = wrapper[0];
    args = [...wrapper.slice(1), input.executable, ...args];
  }
  const child = NodeChildProcess.spawn(executable, args, {
    cwd: input.cwd,
    env: toolEnvironment(input.cwd),
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
    // oxlint-disable-next-line t3code/no-global-process-runtime -- process groups are a host decision outside Effect.
    detached: process.platform !== "win32",
  });
  const terminate = () => {
    try {
      // oxlint-disable-next-line t3code/no-global-process-runtime -- process groups are a host decision outside Effect.
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGKILL");
    }
  };
  return { child, terminate };
}
/** Output/time bounds are NOT a filesystem sandbox; sandbox:true requires isolation separately. */
export function runBoundedTool(input: ToolInput): Promise<ToolResult> {
  const timeoutMs = Math.max(20, Math.min(input.timeoutMs ?? 60_000, 300_000));
  const cap = Math.max(128, Math.min(input.maxOutputBytes ?? 4 * 1024 * 1024, 16 * 1024 * 1024));
  return new Promise((resolve, reject) => {
    let launched: ReturnType<typeof launchTool>;
    try {
      launched = launchTool(input);
    } catch (error) {
      reject(error);
      return;
    }
    const { child, terminate } = launched;
    child.stdin.end();
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let total = 0,
      truncated = false,
      timedOut = false,
      finished = false;
    const capture = (bytes: Buffer, output: Buffer[]) => {
      if (finished) return;
      const count = Math.min(bytes.length, Math.max(0, cap - total));
      if (count) output.push(Buffer.from(bytes.subarray(0, count)));
      total += count;
      if (count < bytes.length) {
        truncated = true;
        terminate();
      }
    };
    child.stdout.on("data", (bytes: Buffer) => capture(bytes, stdout));
    child.stderr.on("data", (bytes: Buffer) => capture(bytes, stderr));
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const abort = () => terminate();
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) abort();
    const cleanup = () => {
      finished = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
    };
    child.once("error", (error) => {
      if (!finished) {
        cleanup();
        reject(error);
      }
    });
    child.once("close", (code) => {
      if (finished) return;
      cleanup();
      if (input.signal?.aborted) {
        reject(input.signal.reason ?? new Error("Tool execution cancelled"));
        return;
      }
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        truncated,
        timedOut,
      });
    });
  });
}
