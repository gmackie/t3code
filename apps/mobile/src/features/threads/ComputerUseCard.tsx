import { isRunUsingComputer } from "@t3tools/client-runtime/state/computerUse";
import type { CuaWindowPreviewFrame, RunId, ScopedThreadRef } from "@t3tools/contracts";
import { Image } from "expo-image";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { useCuaWindowPreview } from "../../state/cua";
import { useQuietThreadStructure } from "../../state/use-thread-detail";

// Before the first frame, the card reserves a laptop-shaped window.
const DEFAULT_ASPECT_RATIO = 1280 / 800;
const MAX_FRAME_HEIGHT = 200;

/**
 * Mobile's counterpart to web's floating computer card: while the running run
 * drives the computer through Cua Driver, shows that window and a Stop above
 * the composer. It goes away when the run settles.
 */
export function ComputerUseCard(props: {
  readonly threadRef: ScopedThreadRef;
  readonly runningRunId: RunId | null;
  readonly canStop: boolean;
  readonly onStop: () => void;
}) {
  const structure = useQuietThreadStructure(props.threadRef);
  const usingComputer = isRunUsingComputer(
    structure?.projection.turnItems ?? [],
    props.runningRunId,
  );
  // The live capture runs only while the card is mounted.
  return usingComputer ? (
    <ComputerUseCardContent
      threadRef={props.threadRef}
      canStop={props.canStop}
      onStop={props.onStop}
    />
  ) : null;
}

function ComputerUseCardContent(props: {
  readonly threadRef: ScopedThreadRef;
  readonly canStop: boolean;
  readonly onStop: () => void;
}) {
  const gt = useGT();
  const live = useCuaWindowPreview(props.threadRef);
  const liveFrame = live.status === "live" ? (live.frame ?? null) : null;
  // Keep the last frame between captures instead of flashing empty.
  const [lastFrame, setLastFrame] = useState<CuaWindowPreviewFrame | null>(null);
  if (liveFrame !== null && liveFrame !== lastFrame) setLastFrame(liveFrame);
  const frame = live.status === "unavailable" ? null : (liveFrame ?? lastFrame);
  const aspectRatio =
    frame && frame.width > 0 && frame.height > 0 ? frame.width / frame.height : DEFAULT_ASPECT_RATIO;
  const label = frame?.appName ?? gt("Computer");
  const caption =
    frame?.windowTitle && frame.windowTitle !== label ? `${label} · ${frame.windowTitle}` : label;

  return (
    <View className="gap-2 px-4 pb-2">
      <View
        className="items-center overflow-hidden rounded-xl border border-border bg-muted"
        style={{ maxHeight: MAX_FRAME_HEIGHT }}
      >
        {frame ? (
          <Image
            source={{ uri: `data:${frame.mimeType};base64,${frame.dataBase64}` }}
            accessibilityLabel={caption}
            contentFit="contain"
            transition={0}
            style={{ width: "100%", aspectRatio, maxHeight: MAX_FRAME_HEIGHT }}
          />
        ) : (
          <View
            className="w-full items-center justify-center"
            style={{ aspectRatio, maxHeight: MAX_FRAME_HEIGHT }}
          >
            <AppText textRole="footnote" className="text-foreground-muted">
              {live.status === "unavailable"
                ? (live.detail ?? gt("Preview unavailable"))
                : gt("Waiting for the agent…")}
            </AppText>
          </View>
        )}
      </View>
      <View className="flex-row items-center gap-2">
        <SymbolView name="desktopcomputer" size={14} tintColorClassName="accent-icon-muted" />
        <AppText textRole="footnote" className="min-w-0 flex-1 text-foreground" numberOfLines={1}>
          {gt("Using your computer")}
          {frame ? ` · ${caption}` : ""}
        </AppText>
        {props.canStop ? (
          <Button
            label={gt("Stop", { $context: "verb, stops the running agent turn" })}
            tone="text"
            onPress={props.onStop}
          />
        ) : null}
      </View>
    </View>
  );
}
