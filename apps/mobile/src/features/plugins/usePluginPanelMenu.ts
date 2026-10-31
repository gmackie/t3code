import { useNavigation } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import { mcpPluginEnvironment } from "../../state/mcpApps";
import { useEnvironmentQuery } from "../../state/query";
import { pluginPanelChoices, pluginPanelRouteParams } from "./pluginPanels";

export interface PluginPanelMenuEntry {
  readonly key: string;
  readonly title: string;
  readonly pluginName: string;
  readonly onPress: () => void;
}

/** Panels of enabled plugins that open in the PluginPanel screen; empty without any. */
export function usePluginPanelMenu(
  target: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly threadId?: string;
  } | null,
): ReadonlyArray<PluginPanelMenuEntry> {
  const navigation = useNavigation();
  const plugins = useEnvironmentQuery(
    target === null
      ? null
      : mcpPluginEnvironment.list({
          environmentId: EnvironmentId.make(target.environmentId),
          input: {},
        }),
  ).data;
  const environmentId = target?.environmentId;
  const projectId = target?.projectId;
  const threadId = target?.threadId;
  // Header items re-render on identity; keep it stable while nothing changed.
  return useMemo(() => {
    if (plugins === null || environmentId === undefined || projectId === undefined) return [];
    return pluginPanelChoices(plugins, { threadOpen: threadId !== undefined }).map((choice) => ({
      key: choice.key,
      title: choice.title,
      pluginName: choice.pluginName,
      onPress: () =>
        navigation.navigate(
          "PluginPanel",
          pluginPanelRouteParams(choice, {
            environmentId,
            projectId,
            ...(threadId === undefined ? {} : { threadId }),
          }),
        ),
    }));
  }, [plugins, environmentId, projectId, threadId, navigation]);
}
