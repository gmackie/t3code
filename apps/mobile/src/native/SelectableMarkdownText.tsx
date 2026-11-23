import { useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { useGT } from "gt-react-native";
import type { AssistantCitation } from "@t3tools/contracts";
import { parseAssistantCitationHref } from "@t3tools/shared/assistantCitations";
import { AssistantCitationSheet } from "../components/AssistantCitationSheet";
import { copyTextWithHaptic } from "../lib/copyTextWithHaptic";
import type { SelectableMarkdownTextProps } from "./SelectableMarkdownText.types";

import { MobileEnrichedMarkdownText } from "./EnrichedMarkdownText";
import { MermaidCodeBlock } from "../features/threads/MermaidCodeBlock";
import { splitMermaidMarkdown } from "../lib/mermaidMarkdownSegments";
import { themeColorWithAlpha } from "../lib/mobileTheme";
import { useUniwindTheme } from "../lib/useUniwindTheme";

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
  const [citation, setCitation] = useState<AssistantCitation | null>(null);
  const gt = useGT();
  const hasCitations = props.markdown.includes("t3-citation:");
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
  // Enriched has no code-block render hook, so diagrams render between
  // separate markdown views. Each fence stays available as the source view.
  return (
    <>
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
              // oxlint-disable-next-line react/no-array-index-key -- segments are positional slices of one markdown string, never reordered
              key={index}
              markdown={markdown}
              textStyle={textStyle}
              onLinkPress={
                hasCitations
                  ? (href) => {
                      const quote = parseAssistantCitationHref(href);
                      if (quote) setCitation(quote);
                      else props.onLinkPress?.(href);
                    }
                  : props.onLinkPress
              }
              fileContextMenu={
                hasCitations
                  ? (href) =>
                      parseAssistantCitationHref(href)
                        ? {
                            title: gt("Assistant quote"),
                            actions: [
                              { id: "open-quote", title: gt("Open quote") },
                              { id: "copy-quote", title: gt("Copy quote") },
                            ],
                          }
                        : props.fileContextMenu?.(href)
                  : props.fileContextMenu
              }
              onFileContextMenuAction={
                hasCitations
                  ? (href, actionId) => {
                      const quote = parseAssistantCitationHref(href);
                      if (quote) {
                        if (actionId === "open-quote") setCitation(quote);
                        else if (actionId === "copy-quote") copyTextWithHaptic(quote.text);
                      } else props.onFileContextMenuAction?.(href, actionId);
                    }
                  : props.onFileContextMenuAction
              }
              marginTop={undefined}
              marginBottom={undefined}
            />
          );
          return segment.kind === "mermaid" ? (
            <MermaidCodeBlock
              // oxlint-disable-next-line react/no-array-index-key -- positional slice; the source remounts the diagram when it changes
              key={`${index}:${segment.source}`}
              source={segment.source}
              fallback={text}
            />
          ) : (
            text
          );
        })}
      </View>
      {citation ? (
        <AssistantCitationSheet citation={citation} onClose={() => setCitation(null)} />
      ) : null}
    </>
  );
}
