import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import script from "@t3tools/mobile-mermaid";

import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { mermaidHeight, mermaidHtml } from "./mermaidHtml";

function Diagram({
  source,
  dark,
  expanded = false,
  onError,
}: {
  source: string;
  dark: boolean;
  expanded?: boolean;
  onError: () => void;
}) {
  const [height, setHeight] = useState(160);
  const [ready, setReady] = useState(expanded);
  // Streaming source remounts this preview. Wait for a pause before starting
  // a WebView and Mermaid layout, rather than doing both for every token.
  useEffect(() => {
    if (expanded) return;
    const timer = setTimeout(() => setReady(true), 300);
    return () => clearTimeout(timer);
  }, [expanded]);
  const document = useMemo(
    () => ({ html: ready ? mermaidHtml(script, source, dark, expanded) : "" }),
    [ready, source, dark, expanded],
  );
  if (!ready)
    return (
      <Text style={[styles.notice, { color: dark ? "#fafafa" : "#18181b" }]}>
        Preparing diagram…
      </Text>
    );
  return (
    <WebView
      source={document}
      style={expanded ? styles.expanded : { height, flex: 0, backgroundColor: "transparent" }}
      originWhitelist={["*"]}
      onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
      scrollEnabled={expanded}
      setBuiltInZoomControls={expanded}
      setDisplayZoomControls={false}
      onError={onError}
      onContentProcessDidTerminate={onError}
      onRenderProcessGone={onError}
      onMessage={({ nativeEvent }) => {
        const measured = mermaidHeight(nativeEvent.data);
        if (measured !== null) setHeight(measured);
        else onError();
      }}
    />
  );
}

const MermaidCodeBlock = memo(function MermaidCodeBlock({
  source,
  fallback,
}: {
  source: string;
  fallback: ReactNode;
}) {
  const { themeAppearance } = useAppearancePreferences();
  const dark = themeAppearance === "dark";
  const [showSource, setShowSource] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const color = dark ? "#fafafa" : "#18181b";
  const backgroundColor = dark ? "#18181b" : "#fff";
  return (
    <View style={[styles.frame, { backgroundColor }]}>
      <View style={styles.toolbar}>
        <Text style={{ color }}>Mermaid</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (failed) {
              setFailed(false);
              setShowSource(false);
            } else setShowSource(!showSource);
          }}
          style={styles.button}
        >
          <Text style={{ color }}>{failed ? "Retry" : showSource ? "Diagram" : "Source"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Expand diagram"
          onPress={() => setExpanded(true)}
          style={styles.button}
        >
          <Text style={{ color }}>Expand</Text>
        </Pressable>
      </View>
      {failed ? (
        <Text style={[styles.notice, { color }]}>
          Unable to render diagram. Source is shown below.
        </Text>
      ) : null}
      {showSource || failed ? (
        fallback
      ) : (
        <Diagram source={source} dark={dark} onError={() => setFailed(true)} />
      )}
      <Modal visible={expanded} onRequestClose={() => setExpanded(false)} animationType="slide">
        <SafeAreaProvider>
          <SafeAreaView style={[styles.expanded, { backgroundColor }]}>
            <View style={styles.toolbar}>
              <Text style={{ color }}>Pinch to zoom · Drag to pan</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setExpanded(false)}
                style={styles.button}
              >
                <Text style={{ color }}>Close</Text>
              </Pressable>
            </View>
            {expanded ? (
              <Diagram
                source={source}
                dark={dark}
                expanded
                onError={() => {
                  setFailed(true);
                  setExpanded(false);
                }}
              />
            ) : null}
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
});

/** Shared by iOS and Android markdown, including nested blocks and file previews. */
export function renderMermaidCodeBlock(
  source: string,
  language: string | undefined,
  fallback: ReactNode,
) {
  return language?.trim().toLowerCase() === "mermaid" ? (
    <MermaidCodeBlock key={source} source={source} fallback={fallback} />
  ) : null;
}

const styles = StyleSheet.create({
  frame: { borderRadius: 10, overflow: "hidden", marginVertical: 4 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  button: {
    minHeight: 44,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  notice: { padding: 12 },
  expanded: { flex: 1 },
});
