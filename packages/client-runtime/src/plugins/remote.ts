import type {
  PluginCapabilityGrantInput,
  PluginInstallInput,
  PluginSettingsGetInput,
  PluginSettingsResetInput,
  PluginSettingsUpdateInput,
  PluginActionInput,
  PluginPanelGetInput,
  PluginSurfaceGetInput,
  PluginWorkflowGetInput,
  PluginWorkflowActionInput,
} from "@t3tools/contracts";

import { request } from "../rpc/client.ts";
import { WS_METHODS } from "@t3tools/contracts";

export const list = () => request(WS_METHODS.pluginList, {});

export const install = (input: PluginInstallInput) => request(WS_METHODS.pluginInstall, input);

export const enable = (pluginId: string) => request(WS_METHODS.pluginEnable, { pluginId });

export const disable = (pluginId: string) => request(WS_METHODS.pluginDisable, { pluginId });

export const grant = (input: PluginCapabilityGrantInput) => request(WS_METHODS.pluginGrant, input);

export const revoke = (input: PluginCapabilityGrantInput) =>
  request(WS_METHODS.pluginRevoke, input);

export const health = (pluginId: string) => request(WS_METHODS.pluginHealth, { pluginId });
export const surfaceGet = (input: PluginSurfaceGetInput) =>
  request(WS_METHODS.pluginSurfaceGet, input);
export const panelGet = (input: PluginPanelGetInput) => request(WS_METHODS.pluginPanelGet, input);
export const workflowGet = (input: PluginWorkflowGetInput) =>
  request(WS_METHODS.pluginWorkflowGet, input);
export const workflowAction = (input: PluginWorkflowActionInput) =>
  request(WS_METHODS.pluginWorkflowAction, input);
export const action = (input: PluginActionInput) => request(WS_METHODS.pluginAction, input);
export const settingsGet = (input: PluginSettingsGetInput) =>
  request(WS_METHODS.pluginSettingsGet, input);
export const settingsUpdate = (input: PluginSettingsUpdateInput) =>
  request(WS_METHODS.pluginSettingsUpdate, input);
export const settingsReset = (input: PluginSettingsResetInput) =>
  request(WS_METHODS.pluginSettingsReset, input);

export type PluginRemoteApi = {
  readonly list: typeof list;
  readonly install: typeof install;
  readonly enable: typeof enable;
  readonly disable: typeof disable;
  readonly grant: typeof grant;
  readonly revoke: typeof revoke;
  readonly health: typeof health;
  readonly surfaceGet: typeof surfaceGet;
  readonly panelGet: typeof panelGet;
  readonly workflowGet: typeof workflowGet;
  readonly workflowAction: typeof workflowAction;
  readonly action: typeof action;
  readonly settingsGet: typeof settingsGet;
  readonly settingsUpdate: typeof settingsUpdate;
  readonly settingsReset: typeof settingsReset;
};

export const pluginRemoteApi: PluginRemoteApi = {
  list,
  install,
  enable,
  disable,
  grant,
  revoke,
  health,
  surfaceGet,
  panelGet,
  workflowGet,
  workflowAction,
  action,
  settingsGet,
  settingsUpdate,
  settingsReset,
};
