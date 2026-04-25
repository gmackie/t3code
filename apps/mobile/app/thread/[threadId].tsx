import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApprovalCard } from "../../src/components/ApprovalCard";
import { RecoveryActions } from "../../src/components/RecoveryActions";
import { ThreadComposer } from "../../src/components/ThreadComposer";
import { ThreadTranscript } from "../../src/components/ThreadTranscript";
import { loadSavedEnvironmentSnapshot } from "../../src/lib/runtimeClient";
import {
  approveThreadRequest,
  interruptThreadTurn,
  sendThreadPrompt,
  stopThreadSession,
} from "../../src/lib/threadActions";
import { readEnvironmentSecret, useEnvironmentStore } from "../../src/state/environmentStore";
import { getThreadDetail, useThreadStore } from "../../src/state/threadStore";
import { mobileTheme } from "../../src/theme";

export default function ThreadDetailScreen() {
  const params = useLocalSearchParams<{ threadId?: string; environmentId?: string }>();
  const threadId = params.threadId;
  const environmentId = params.environmentId;
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const record = useEnvironmentStore((state) =>
    environmentId ? state.recordsById[environmentId as never] : null,
  );
  const thread =
    threadId && environmentId ? getThreadDetail(environmentId as never, threadId as never) : null;
  const applySnapshot = useThreadStore((state) => state.applySnapshot);
  const setConnectionState = useThreadStore((state) => state.setEnvironmentConnectionState);
  const connectionState = useThreadStore(
    (state) =>
      (environmentId ? state.connectionStateByEnvironment[environmentId as never] : undefined) ??
      "idle",
  );
  const actionsDisabled = !record || !threadId || !sessionToken;

  useEffect(() => {
    if (!environmentId) {
      setSessionToken(null);
      return;
    }

    let active = true;
    void readEnvironmentSecret(environmentId as never)
      .then((token) => {
        if (active) {
          setSessionToken(token);
        }
      })
      .catch((error) => {
        console.error("[mobile] failed to read environment secret", error);
      });

    return () => {
      active = false;
    };
  }, [environmentId]);

  const refreshThread = useCallback(async () => {
    if (!record || !sessionToken) {
      return;
    }

    setConnectionState(record.environmentId, "syncing");
    try {
      const loaded = await loadSavedEnvironmentSnapshot({
        record,
        sessionToken,
      });
      applySnapshot(loaded.environmentId, loaded.snapshot);
    } catch (error) {
      setConnectionState(record.environmentId, "error");
      throw error;
    }
  }, [applySnapshot, record, sessionToken, setConnectionState]);

  const runAction = async (action: () => Promise<void>) => {
    try {
      await action();
      await refreshThread();
    } catch (error) {
      Alert.alert("Action failed", error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ThreadTranscript connectionState={connectionState} thread={thread} />
      <View style={styles.controls}>
        <ApprovalCard
          disabled={actionsDisabled}
          onRespond={(requestId, decision) =>
            runAction(() =>
              approveThreadRequest({
                httpBaseUrl: record?.httpBaseUrl ?? "",
                sessionToken: sessionToken ?? "",
                threadId: threadId ?? "",
                requestId,
                decision,
              }),
            )
          }
          requestId={thread?.pendingApproval?.requestId ?? null}
          summary={thread?.pendingApproval?.summary ?? null}
        />
        <RecoveryActions
          disabled={actionsDisabled}
          onInterrupt={() =>
            runAction(() =>
              interruptThreadTurn({
                httpBaseUrl: record?.httpBaseUrl ?? "",
                sessionToken: sessionToken ?? "",
                threadId: threadId ?? "",
              }),
            )
          }
          onRefresh={refreshThread}
          onStop={() =>
            runAction(() =>
              stopThreadSession({
                httpBaseUrl: record?.httpBaseUrl ?? "",
                sessionToken: sessionToken ?? "",
                threadId: threadId ?? "",
              }),
            )
          }
        />
      </View>
      <ThreadComposer
        disabled={actionsDisabled}
        onSubmit={(text) =>
          runAction(() =>
            sendThreadPrompt({
              httpBaseUrl: record?.httpBaseUrl ?? "",
              sessionToken: sessionToken ?? "",
              threadId: threadId ?? "",
              text,
            }),
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: mobileTheme.colors.background,
  },
  controls: {
    gap: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.md,
  },
});
