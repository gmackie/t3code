import type { PluginRpcRequest, PluginRpcResponse } from "@t3tools/contracts";

type PluginTransport = {
  send(message: PluginRpcRequest): Promise<PluginRpcResponse>;
};

export class PluginHost {
  #states = new Map<string, "enabled" | "disabled">();
  #transport: PluginTransport;
  #nextRequestId = 1;

  constructor(transport: PluginTransport) {
    this.#transport = transport;
  }

  register(pluginId: string, state: "enabled" | "disabled"): void {
    this.#states.set(pluginId, state);
  }

  async call<T>(pluginId: string, method: string, payload: unknown): Promise<T> {
    if (this.#states.get(pluginId) !== "enabled")
      throw new Error(`plugin is not enabled: ${pluginId}`);
    const response = await this.#transport.send({
      type: "plugin.request",
      requestId: `${pluginId}:${this.#nextRequestId++}`,
      method,
      payload,
    });
    if (!response.ok) throw new Error(response.error);
    return response.result as T;
  }
}
