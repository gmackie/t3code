import type { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import { WS_METHODS } from "@t3tools/contracts";

export function createPluginEnvironmentAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "plugins:list",
    tag: WS_METHODS.pluginList,
    staleTimeMs: 1_000,
  });
  const install = createEnvironmentRpcCommand(runtime, {
    label: "plugins:install",
    tag: WS_METHODS.pluginInstall,
  });
  const enable = createEnvironmentRpcCommand(runtime, {
    label: "plugins:enable",
    tag: WS_METHODS.pluginEnable,
  });
  const disable = createEnvironmentRpcCommand(runtime, {
    label: "plugins:disable",
    tag: WS_METHODS.pluginDisable,
  });
  const grant = createEnvironmentRpcCommand(runtime, {
    label: "plugins:grant",
    tag: WS_METHODS.pluginGrant,
  });
  const revoke = createEnvironmentRpcCommand(runtime, {
    label: "plugins:revoke",
    tag: WS_METHODS.pluginRevoke,
  });
  const health = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "plugins:health",
    tag: WS_METHODS.pluginHealth,
    staleTimeMs: 1_000,
  });
  const surfaceGet = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "plugins:surface:get",
    tag: WS_METHODS.pluginSurfaceGet,
    staleTimeMs: 5_000,
  });
  const panelGet = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "plugins:panel:get",
    tag: WS_METHODS.pluginPanelGet,
    staleTimeMs: 2_000,
  });
  const workflowGet = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "plugins:workflow:get",
    tag: WS_METHODS.pluginWorkflowGet,
    staleTimeMs: 2_000,
  });
  const action = createEnvironmentRpcCommand(runtime, {
    label: "plugins:action",
    tag: WS_METHODS.pluginAction,
  });
  const workflowAction = createEnvironmentRpcCommand(runtime, {
    label: "plugins:workflow:action",
    tag: WS_METHODS.pluginWorkflowAction,
  });
  const settingsGet = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "plugins:settings:get",
    tag: WS_METHODS.pluginSettingsGet,
    staleTimeMs: 1_000,
  });
  const settingsUpdate = createEnvironmentRpcCommand(runtime, {
    label: "plugins:settings:update",
    tag: WS_METHODS.pluginSettingsUpdate,
  });
  const settingsReset = createEnvironmentRpcCommand(runtime, {
    label: "plugins:settings:reset",
    tag: WS_METHODS.pluginSettingsReset,
  });

  return {
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
    action,
    workflowAction,
    settingsGet,
    settingsUpdate,
    settingsReset,
  };
}
