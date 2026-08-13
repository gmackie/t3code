// @effect-diagnostics nodeBuiltinImport:off - managed plugins are launched at the server process boundary.
import * as NodeChildProcess from "node:child_process";

import type { PluginHealth, PluginRpcRequest, PluginRpcResponse } from "@t3tools/contracts";

export type ManagedPluginProcess = {
  stop(): Promise<void>;
  request?(message: PluginRpcRequest): Promise<PluginRpcResponse>;
};

export type ManagedPluginLauncher = {
  start(
    command: readonly string[],
    onCrash: () => void,
    cwd?: string,
  ): Promise<ManagedPluginProcess>;
};

export function createNodeManagedPluginLauncher(): ManagedPluginLauncher {
  return {
    async start(command, onCrash, cwd) {
      const [executable, ...args] = command;
      if (!executable) throw new Error("managed plugin command cannot be empty");
      const child = NodeChildProcess.spawn(executable, args, {
        stdio: ["pipe", "pipe", "ignore"],
        ...(cwd ? { cwd } : {}),
      });
      let stopped = false;
      let exited = false;
      let crashNotified = false;
      const pending = new Map<
        string,
        { resolve: (response: PluginRpcResponse) => void; reject: (error: Error) => void }
      >();
      const rejectPending = (error: Error) => {
        for (const request of pending.values()) request.reject(error);
        pending.clear();
      };
      let stdoutBuffer = "";
      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line) as PluginRpcResponse;
            const request = pending.get(response.requestId);
            if (!request) continue;
            pending.delete(response.requestId);
            request.resolve(response);
          } catch {
            // Ignore non-protocol stdout; plugin diagnostics belong on stderr.
          }
        }
      });
      const exit = new Promise<void>((resolve) => {
        child.once("exit", () => {
          exited = true;
          rejectPending(new Error("managed plugin process exited"));
          if (!stopped && !crashNotified) {
            crashNotified = true;
            onCrash();
          }
          resolve();
        });
      });
      child.once("error", () => {
        rejectPending(new Error("managed plugin process failed to start"));
        if (!stopped && !crashNotified) {
          crashNotified = true;
          onCrash();
        }
      });
      return {
        request: (message) => {
          if (exited || !child.stdin)
            return Promise.reject(new Error("managed plugin is not running"));
          return new Promise<PluginRpcResponse>((resolve, reject) => {
            pending.set(message.requestId, { resolve, reject });
            child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
              if (!error) return;
              pending.delete(message.requestId);
              reject(error);
            });
          });
        },
        stop: async () => {
          if (exited) return;
          stopped = true;
          child.stdin?.end();
          child.kill();
          await exit;
        },
      };
    },
  };
}

export class PluginRuntimeSupervisor {
  readonly #launcher: ManagedPluginLauncher;
  readonly #processes = new Map<string, ManagedPluginProcess>();
  readonly #health = new Map<string, PluginHealth["state"]>();

  constructor(launcher: ManagedPluginLauncher) {
    this.#launcher = launcher;
  }

  async start(pluginId: string, command: readonly string[], cwd?: string): Promise<PluginHealth> {
    if (this.#processes.has(pluginId)) throw new Error(`plugin already running: ${pluginId}`);
    this.#health.set(pluginId, "starting");
    const process = await this.#launcher.start(
      command,
      () => {
        this.#processes.delete(pluginId);
        this.#health.set(pluginId, "crashed");
      },
      cwd,
    );
    this.#processes.set(pluginId, process);
    this.#health.set(pluginId, "healthy");
    return this.health(pluginId);
  }

  async stop(pluginId: string): Promise<PluginHealth> {
    const process = this.#processes.get(pluginId);
    if (process) await process.stop();
    this.#processes.delete(pluginId);
    this.#health.set(pluginId, "stopped");
    return this.health(pluginId);
  }

  request(pluginId: string, message: PluginRpcRequest): Promise<PluginRpcResponse> {
    const process = this.#processes.get(pluginId);
    if (!process?.request) throw new Error(`plugin does not support RPC: ${pluginId}`);
    return process.request(message);
  }

  health(pluginId: string): PluginHealth {
    return { pluginId, state: this.#health.get(pluginId) ?? "stopped" };
  }
}
