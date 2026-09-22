import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useScaledTextRole } from "../settings/appearance/useScaledTextRole";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";

export function ThreadHeaderTitle(props: {
  readonly threadId: string;
  readonly title: string;
  readonly subtitle?: string | null;
  readonly maxWidth?: number;
}) {
  const titleTypography = useScaledTextRole("title");
  const subtitleTypography = useScaledTextRole("label");
  const [feedback, setFeedback] = useState<{ message: string } | null>(null);

  useEffect(() => {
    if (!feedback) return;
    AccessibilityInfo.announceForAccessibility(feedback.message);
    const timeout = setTimeout(() => setFeedback(null), 2000);
    return () => clearTimeout(timeout);
  }, [feedback]);

  const copyThreadId = async () => {
    const copied = await tryCopyTextWithHaptic(props.threadId, { target: "thread ID" });
    setFeedback({ message: copied ? "Copied thread ID" : "Could not copy thread ID" });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.title}
      accessibilityHint="Long press to copy thread ID"
      accessibilityActions={[{ name: "activate", label: "Copy thread ID" }]}
      onAccessibilityAction={copyThreadId}
      onLongPress={copyThreadId}
      hitSlop={8}
      style={{ minWidth: 0, flexShrink: 1, maxWidth: props.maxWidth }}
    >
      <Text
        numberOfLines={1}
        className={
          Platform.OS === "android" ? "text-header-foreground" : "font-t3-bold text-foreground"
        }
        style={Platform.OS === "android" ? titleTypography : { fontSize: 17 }}
      >
        {props.title}
      </Text>
      {feedback || props.subtitle ? (
        <Text
          numberOfLines={1}
          style={Platform.OS === "android" ? subtitleTypography : undefined}
          className="text-[13px] font-t3-medium text-foreground-muted"
        >
          {feedback?.message ?? props.subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}
