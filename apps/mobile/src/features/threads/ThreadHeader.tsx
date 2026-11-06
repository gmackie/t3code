import { useMemo } from "react";
import type { PluginPanelMenuEntry } from "../plugins/usePluginPanelMenu";
import { AppBar } from "../../components/ui/AppBar";
import { ScreenHeaderButton } from "../../components/ui/ScreenHeaderButton";
import type { AppBarAction, AppBarMenu } from "../../components/ui/AppBar.types";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
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
  readonly fileInspectorSupported: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onToggleInspector: () => void;
  readonly onOpenFilesInspector: () => void;
}) {
  const goBack = useWorkspaceBackNavigation("threads");
  const { panes, toggleAuxiliaryPane, composerKeyboardActive, startNewTask } =
    useAdaptiveWorkspaceLayout();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const inspectorVisible = props.inspectorMode !== null && panes.auxiliaryPaneVisible;
  const actions: AppBarAction[] = props.hasThreadCwd
    ? [
        {
          accessibilityLabel: filesVisible ? "Close files" : "Open files",
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
              title: "Plugin panels",
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
    [pluginPanels],
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
              accessibilityLabel: "Return to chat",
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={[...menus, ...pluginMenus]}
      trailing={
        props.fileInspectorSupported && props.hasThreadCwd ? (
          <ScreenHeaderButton
            accessibilityLabel={inspectorVisible ? "Hide inspector" : "Show inspector"}
            icon="sidebar.right"
            selected={inspectorVisible}
            onPress={props.onToggleInspector}
          />
        ) : null
      }
      hideBottomBorder
      compact={composerKeyboardActive}
    />
  );
}
