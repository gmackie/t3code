import { useMemo } from "react";
import { View } from "react-native";
import { ScreenHeader } from "../../components/ScreenHeader";
import { ScreenHeaderButton } from "../../components/ScreenHeaderButton";
import type { ScreenHeaderAction } from "../../components/ScreenHeader.types";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-content-stack";
import { useThreadHeaderOptions } from "./useThreadHeaderOptions";
import { useWorkspaceListNavigation } from "../workspace/useAndroidWorkspaceNavigation";

export function ThreadHeader(
  props: Parameters<typeof useThreadHeaderOptions>[0] & {
    readonly hasThreadCwd: boolean;
    readonly hasWorkspaceRoot: boolean;
    readonly fileInspectorSupported: boolean;
    readonly inspectorMode: ThreadInspectorMode | null;
    readonly onToggleInspector: () => void;
    readonly onOpenGitInspector: () => void;
    readonly onOpenFilesInspector: () => void;
    readonly onOpenWork: () => void;
  },
) {
  const returnToList = useWorkspaceListNavigation("threads");
  const { layout, panes, toggleAuxiliaryPane } = useAdaptiveWorkspaceLayout();
  const { onOpenTerminal, onMergeBack } = props.gitControls;
  const native = useThreadHeaderOptions(props);
  const androidHeaderActions = useMemo<ReadonlyArray<ScreenHeaderAction>>(() => {
    const actions: ScreenHeaderAction[] = [];
    if (props.onReturnToThread) {
      actions.push({
        accessibilityLabel: "Return to chat",
        icon: "chevron.left",
        onPress: props.onReturnToThread,
      });
    }
    if (props.hasThreadCwd) {
      const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
      actions.push({
        accessibilityLabel: filesVisible ? "Close files" : "Open files",
        selected: filesVisible,
        icon: "folder",
        onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
      });
    }
    if (props.onOpenGame)
      actions.push({
        accessibilityLabel: "Open Unity game",
        icon: "gamecontroller",
        onPress: props.onOpenGame,
      });
    if (props.onOpenCad) {
      actions.push({
        accessibilityLabel: "Switch to CAD mode",
        icon: "cpu",
        onPress: props.onOpenCad,
      });
    }
    if (props.hasWorkspaceRoot && props.gitControls.canOpenTerminal) {
      actions.push({
        accessibilityLabel: "Open terminal",
        icon: "terminal",
        onPress: () => onOpenTerminal(null),
      });
    }
    actions.push({
      accessibilityLabel: "Open Work",
      icon: "list.number",
      onPress: props.onOpenWork,
    });
    actions.push({
      accessibilityLabel: "Open git controls",
      icon: "point.topleft.down.curvedto.point.bottomright.up",
      onPress: props.onOpenGitInspector,
    });
    if (onMergeBack) {
      actions.push({
        accessibilityLabel: "Merge back to source",
        icon: "arrow.triangle.merge",
        onPress: onMergeBack,
      });
    }
    return actions;
  }, [
    props.inspectorMode,
    panes.auxiliaryPaneVisible,
    props.onOpenFilesInspector,
    props.onOpenCad,
    props.onOpenGame,
    onOpenTerminal,
    onMergeBack,
    props.onOpenGitInspector,
    props.onOpenWork,
    toggleAuxiliaryPane,
    props.onReturnToThread,
    props.hasThreadCwd,
    props.hasWorkspaceRoot,
    props.gitControls.canOpenTerminal,
  ]);

  return (
    <>
      <ScreenHeader
        title={props.title}
        subtitle={props.subtitle}
        sidebar={native.sidebar}
        options={native.options}
        optionsVersion={native.optionsVersion}
        trailing={
          <View className="flex-row">
            <ScreenHeaderButton
              accessibilityLabel="Open Work"
              icon="list.number"
              onPress={props.onOpenWork}
            />
            {props.fileInspectorSupported && props.hasThreadCwd ? (
              <ScreenHeaderButton
                accessibilityLabel={
                  props.inspectorMode !== null && panes.auxiliaryPaneVisible
                    ? "Hide inspector"
                    : "Show inspector"
                }
                icon="sidebar.right"
                selected={props.inspectorMode !== null && panes.auxiliaryPaneVisible}
                onPress={props.onToggleInspector}
              />
            ) : null}
          </View>
        }
        onBack={layout.usesSplitView ? undefined : returnToList}
        actions={androidHeaderActions}
        hideBottomBorder
      />
      {native.fallback}
    </>
  );
}
