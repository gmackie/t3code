import { useMemo } from "react";
import type { PluginPanelMenuEntry } from "../plugins/usePluginPanelMenu";
import { useGT, useMessages } from "gt-react-native";

import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu } from "../../components/ui/AppBar.types";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";

export function ThreadHeader(props: {
  readonly onOpenCad?: () => void;
  readonly onOpenGame?: () => void;
  readonly onOpenSystems?: () => void;
  readonly onOpenWork?: () => void;
  readonly pluginPanels?: ReadonlyArray<PluginPanelMenuEntry>;
  readonly title: string;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const goBack = useWorkspaceBackNavigation();
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls, m);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const actions: AppBarAction[] = props.hasThreadCwd
    ? [
        {
          accessibilityLabel: filesVisible ? gt("Close files") : gt("Open files"),
          icon: "folder",
          selected: filesVisible,
          disabled: !props.gitControls.canOpenFiles,
          separateBackground: false,
          onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
        },
      ]
    : [];
  for (const [onPress, accessibilityLabel, icon] of [
    [props.onOpenCad, "Switch to CAD mode", "cpu"],
    [props.onOpenGame, "Open Unity game", "gamecontroller"],
    [props.onOpenSystems, "Open Systems", "waveform.path.ecg"],
    [props.onOpenWork, "Open Work", "list.number"],
  ] as const) {
    if (onPress) actions.push({ accessibilityLabel, icon, onPress });
  }
  const menus = [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);

  // iOS reads the native header items; AppBar renders menus on Android.
  const pluginPanels = props.pluginPanels;
  const pluginMenus = useMemo<ReadonlyArray<AppBarMenu>>(
    () =>
      pluginPanels && pluginPanels.length > 0
        ? [
            {
              title: gt("Plugin panels"),
              icon: "square.grid.2x2",
              items: pluginPanels.map((panel) => ({
                id: panel.key,
                title: panel.title,
                subtitle: panel.pluginName,
                onPress: panel.onPress,
              })),
            },
          ]
        : [],
    [pluginPanels, gt],
  );

  return (
    <AppBar
      title={props.title}
      subtitle={props.subtitle}
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: gt("Return to chat"),
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={[...menus, ...pluginMenus]}
      hideBottomBorder
    />
  );
}
