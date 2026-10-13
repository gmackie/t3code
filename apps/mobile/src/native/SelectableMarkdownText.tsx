import { useMemo } from "react";
import { Platform, View } from "react-native";
import type { SelectableMarkdownTextProps } from "./SelectableMarkdownText.types";

import { MobileEnrichedMarkdownText } from "./EnrichedMarkdownText";
import { MermaidCodeBlock } from "../features/threads/MermaidCodeBlock";
import { splitMermaidMarkdown } from "../lib/mermaidMarkdownSegments";
import { themeColorWithAlpha } from "../lib/mobileTheme";
import { useUniwindTheme } from "../state/appearance/useUniwindTheme";

export type {
  MarkdownFileContextMenu,
  MarkdownFileContextMenuAction,
  MarkdownImageRenderer,
  MarkdownImageRequest,
  MarkdownImageSourceResolver,
  MarkdownLinkCustomization,
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
} from "./SelectableMarkdownText.types";

export function SelectableMarkdownText(props: SelectableMarkdownTextProps) {
  const theme = useUniwindTheme();
  const selectionColor = themeColorWithAlpha(theme["--color-focus"], 0.32);
  const selectionHandleColor = theme["--color-focus"];
  const textStyle = useMemo(
    () =>
      Platform.OS === "android"
        ? { selectionColor, selectionHandleColor, ...props.textStyle }
        : props.textStyle,
    [props.textStyle, selectionColor, selectionHandleColor],
  );
  const segments = useMemo(() => splitMermaidMarkdown(props.markdown), [props.markdown]);
  if (segments.length === 1 && segments[0]!.kind === "markdown") {
    return <MobileEnrichedMarkdownText {...props} textStyle={textStyle} />;
  }
  // Enriched has no code-block render hook, so diagrams render between
  // separate markdown views. Each fence stays available as the source view.
  return (
    <View
      style={{
        flexShrink: 1,
        minWidth: 0,
        marginTop: props.marginTop,
        marginBottom: props.marginBottom,
      }}
    >
      {segments.map((segment, index) => {
        const markdown = segment.kind === "markdown" ? segment.markdown : segment.fence;
        const text = (
          <MobileEnrichedMarkdownText
            {...props}
            key={index}
            markdown={markdown}
            textStyle={textStyle}
            marginTop={undefined}
            marginBottom={undefined}
          />
        );
        return segment.kind === "mermaid" ? (
          <MermaidCodeBlock
            key={`${index}:${segment.source}`}
            source={segment.source}
            fallback={text}
          />
        ) : (
          text
        );
      })}
    </View>
  );
}
