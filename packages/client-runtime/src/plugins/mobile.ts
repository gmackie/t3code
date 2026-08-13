import type {
  DispatchWorkItemInput,
  PluginRunSummary,
  WorkItem,
  WorkItemDetail,
  WorkItemScope,
  WorkItemDispatchResult,
  PluginSurfaceModel,
  PluginPanelGetInput,
  PluginPanelModel,
  PluginActionInput,
  PluginActionResult,
} from "@t3tools/contracts";

import type { PluginHost } from "./host.ts";

export class MobilePluginBridge {
  readonly #host: PluginHost;

  constructor(host: PluginHost) {
    this.#host = host;
  }

  listWorkItems(pluginId: string, scope: WorkItemScope): Promise<readonly WorkItem[]> {
    return this.#host.call(pluginId, "work-source.list", scope);
  }

  getWorkItem(pluginId: string, itemId: string): Promise<WorkItemDetail> {
    return this.#host.call(pluginId, "work-source.get", { itemId });
  }

  listRuns(pluginId: string, workItemId?: string): Promise<readonly PluginRunSummary[]> {
    return this.#host.call(pluginId, "runs.list", { workItemId });
  }

  dispatchWorkItem(
    pluginId: string,
    input: DispatchWorkItemInput,
  ): Promise<WorkItemDispatchResult> {
    return this.#host.call(pluginId, "work-source.dispatch", input);
  }

  openThread(pluginId: string, threadId: string): Promise<{ threadId: string }> {
    return this.#host.call(pluginId, "threads.open", { threadId });
  }

  getSurface(
    pluginId: string,
    navigationId: string,
    context: { projectId?: string; threadId?: string } = {},
  ): Promise<PluginSurfaceModel> {
    return this.#host.call(pluginId, "surface.get", { pluginId, navigationId, ...context });
  }

  getPanel(input: PluginPanelGetInput): Promise<PluginPanelModel> {
    return this.#host.call(input.pluginId, "panel.get", input);
  }

  runAction(input: PluginActionInput): Promise<PluginActionResult> {
    return this.#host.call(input.pluginId, "action.execute", input);
  }
}
