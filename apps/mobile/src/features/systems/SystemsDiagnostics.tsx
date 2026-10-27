import type { SystemsDiagnostic } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

/** A failed command's cause as a line the user can read. */
export const failureText = (cause: unknown) =>
  cause instanceof Error && cause.message.trim() ? cause.message : String(cause);

export type SystemsTone = "success" | "error" | "warning" | "info";

const TONE_CLASS_NAMES = {
  success: ["bg-adaptive-emerald-500-a12-a16", "text-adaptive-emerald-700-300"],
  error: ["bg-adaptive-rose-500-a12-a16", "text-adaptive-rose-700-300"],
  warning: ["bg-adaptive-amber-500-a12-a16", "text-adaptive-amber-700-300"],
  info: ["bg-adaptive-sky-500-a12-a16", "text-adaptive-sky-700-300"],
} as const satisfies Record<SystemsTone, readonly [string, string]>;

/** A compact status pill, toned like the web workbench's badges. */
export function SystemsBadge(props: { readonly label: string; readonly tone: SystemsTone }) {
  const [container, label] = TONE_CLASS_NAMES[props.tone];
  return (
    <View className={cn("self-start rounded-full px-2 py-0.5", container)}>
      <Text textRole="caption" className={cn("font-t3-medium", label)}>
        {props.label}
      </Text>
    </View>
  );
}

export function SystemsDiagnostics(props: {
  readonly diagnostics: ReadonlyArray<SystemsDiagnostic>;
  readonly empty: string;
}) {
  if (!props.diagnostics.length)
    return props.empty ? (
      <Text textRole="footnote" className="text-foreground-muted">
        {props.empty}
      </Text>
    ) : null;
  return (
    <View className="gap-2">
      {props.diagnostics.map((diagnostic) => (
        <View
          key={`${diagnostic.code}:${diagnostic.file ?? ""}${diagnostic.pointer ?? ""}:${diagnostic.elementId ?? ""}:${diagnostic.message}`}
          className="gap-1"
        >
          <SystemsBadge
            label={diagnostic.code}
            tone={diagnostic.severity === "error" ? "error" : "warning"}
          />
          <Text selectable textRole="footnote">
            {diagnostic.elementId ? (
              <Text className="font-mono">{diagnostic.elementId} </Text>
            ) : null}
            {diagnostic.message}
            {diagnostic.file ? (
              <Text className="text-foreground-muted">
                {" "}
                · {diagnostic.file}
                {diagnostic.pointer ?? ""}
              </Text>
            ) : null}
          </Text>
        </View>
      ))}
    </View>
  );
}
