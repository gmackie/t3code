import * as Schema from "effect/Schema";
import {
  PluginSurfaceModel,
  PluginActionInput,
  PluginActionResult,
  PluginPanelGetInput,
  PluginPanelModel,
  PluginWorkflowGetInput,
  PluginWorkflowActionInput,
  PluginWorkflowModel,
  type PluginHealth,
  type PluginSurfaceGetInput as PluginSurfaceGetInputType,
  type PluginSurfaceModel as PluginSurfaceModelType,
} from "@t3tools/contracts";

import { PluginLifecycle } from "./lifecycle.ts";
import { PluginRuntimeSupervisor } from "./runtimeSupervisor.ts";

const decodePluginSurfaceModel = Schema.decodeUnknownSync(PluginSurfaceModel);
const decodePluginPanelModel = Schema.decodeUnknownSync(PluginPanelModel);
const decodePluginWorkflowModel = Schema.decodeUnknownSync(PluginWorkflowModel);
const decodePluginActionResult = Schema.decodeUnknownSync(PluginActionResult);

export class PluginRuntimeHost {
  readonly #lifecycle: PluginLifecycle;
  readonly #supervisor: PluginRuntimeSupervisor;
  #nextRequestId = 1;

  constructor(lifecycle: PluginLifecycle, supervisor: PluginRuntimeSupervisor) {
    this.#lifecycle = lifecycle;
    this.#supervisor = supervisor;
  }

  async enable(pluginId: string): Promise<PluginHealth> {
    const plugin = this.#plugin(pluginId);
    this.#lifecycle.enable(pluginId);
    if (plugin.manifest.runtime.kind !== "managed-app") return this.#lifecycle.health(pluginId);
    try {
      return await this.#supervisor.start(
        pluginId,
        plugin.manifest.runtime.command,
        plugin.directory,
      );
    } catch (error) {
      this.#lifecycle.disable(pluginId);
      await this.#supervisor.stop(pluginId);
      throw error;
    }
  }

  async disable(pluginId: string): Promise<PluginHealth> {
    const plugin = this.#plugin(pluginId);
    if (plugin.manifest.runtime.kind === "managed-app") await this.#supervisor.stop(pluginId);
    this.#lifecycle.disable(pluginId);
    return this.#lifecycle.health(pluginId);
  }

  health(pluginId: string): PluginHealth {
    const plugin = this.#plugin(pluginId);
    return plugin.manifest.runtime.kind === "managed-app"
      ? this.#supervisor.health(pluginId)
      : this.#lifecycle.health(pluginId);
  }

  async surface(input: PluginSurfaceGetInputType): Promise<PluginSurfaceModelType> {
    return decodePluginSurfaceModel(
      await this.#request(input.pluginId, "surface.get", input, "surface"),
    );
  }

  async panel(input: PluginPanelGetInput): Promise<PluginPanelModel> {
    return decodePluginPanelModel(await this.#request(input.pluginId, "panel.get", input, "panel"));
  }

  async workflow(input: PluginWorkflowGetInput): Promise<PluginWorkflowModel> {
    return decodePluginWorkflowModel(
      await this.#request(input.pluginId, "workflow.get", input, "workflow"),
    );
  }

  async workflowAction(input: PluginWorkflowActionInput): Promise<PluginActionResult> {
    return decodePluginActionResult(
      await this.#request(input.pluginId, "action.execute", input, "action"),
    );
  }

  async action(input: PluginActionInput): Promise<PluginActionResult> {
    return decodePluginActionResult(
      await this.#request(input.pluginId, "action.execute", input, "action"),
    );
  }

  async #request(
    pluginId: string,
    method: string,
    payload: unknown,
    path: string,
  ): Promise<unknown> {
    const plugin = this.#plugin(pluginId);
    if (plugin.manifest.runtime.kind === "managed-app") {
      const response = await this.#supervisor.request(pluginId, {
        type: "plugin.request",
        requestId: `${pluginId}:${this.#nextRequestId++}`,
        method,
        payload,
      });
      if (!response.ok) throw new Error(response.error);
      return response.result;
    }
    const endpoint = `${plugin.manifest.runtime.endpoint.replace(/\/$/u, "")}/${path}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`plugin ${path} request failed: ${response.status}`);
    return response.json();
  }

  #plugin(pluginId: string) {
    const plugin = this.#lifecycle.snapshot().find((entry) => entry.manifest.id === pluginId);
    if (!plugin) throw new Error(`plugin not installed: ${pluginId}`);
    return plugin;
  }
}
