import { useLocalSearchParams } from "expo-router";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThreadTranscript } from "../../src/components/ThreadTranscript";
import { getThreadDetail, useThreadStore } from "../../src/state/threadStore";
import { mobileTheme } from "../../src/theme";

export default function ThreadDetailScreen() {
  const params = useLocalSearchParams<{ threadId?: string; environmentId?: string }>();
  const threadId = params.threadId;
  const environmentId = params.environmentId;
  const thread =
    threadId && environmentId ? getThreadDetail(environmentId as never, threadId as never) : null;
  const connectionState = useThreadStore(
    (state) =>
      (environmentId ? state.connectionStateByEnvironment[environmentId as never] : undefined) ??
      "idle",
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ThreadTranscript connectionState={connectionState} thread={thread} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: mobileTheme.colors.background,
  },
});
