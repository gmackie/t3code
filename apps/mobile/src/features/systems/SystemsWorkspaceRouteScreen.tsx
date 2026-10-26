import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, ProjectId, type SystemsCompileResult } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatTime, statusTone } from "@t3tools/client-runtime/systems-presentation";
import { AsyncResult } from "effect/reactivity";
import { useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { ListSection } from "../../components/ui/ListSection";
import { uuidv4 } from "../../lib/uuid";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useEnvironmentQuery } from "../../state/query";
import { systemsEnvironment } from "../../state/systems";
import { useAtomCommand } from "../../state/use-atom-command";
import { failureText, SystemsBadge, SystemsDiagnostics } from "./SystemsDiagnostics";
import { SystemsParameterEditor } from "./SystemsParameterEditor";
import { normalizeSystemsPath, systemsPathKey, withSystemsPath } from "./systemsPath";

type Props = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly projectId: string;
}>;

export function SystemsWorkspaceRouteScreen({ route }: Props) {
  const { environmentId, threadId, projectId } = route.params;
  const preferences = useAtomValue(mobilePreferencesAtom);
  const key = systemsPathKey(environmentId, projectId);
  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions options={{ title: "Systems" }} />
      {AsyncResult.isInitial(preferences) ? null : (
        <ProjectSystems
          key={key}
          environmentId={EnvironmentId.make(environmentId)}
          threadId={threadId}
          projectId={ProjectId.make(projectId)}
          storedPath={
            AsyncResult.isSuccess(preferences) ? (preferences.value.systemsPaths?.[key] ?? "") : ""
          }
        />
      )}
    </View>
  );
}

function ProjectSystems(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly projectId: ProjectId;
  readonly storedPath: string;
}) {
  const { environmentId, projectId } = props;
  const navigation = useNavigation();
  const updatePreferences = useAtomSet(updateMobilePreferencesAtom);
  const [draft, setDraft] = useState(props.storedPath);
  const [path, setPath] = useState(props.storedPath);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = { environmentId, input: { projectId, path } };
  const validation = useEnvironmentQuery(systemsEnvironment.validate(project));
  const compiled = useEnvironmentQuery(
    validation.data ? systemsEnvironment.compile(project) : null,
  );
  const live = useEnvironmentQuery(systemsEnvironment.runsLive(project));
  const createRun = useAtomCommand(systemsEnvironment.createRun, { reportFailure: false });
  const runs = live.data?.runs ?? [];

  const openRun = (runId: string) =>
    navigation.navigate("SystemsRun", {
      environmentId: String(environmentId),
      threadId: props.threadId,
      projectId: String(projectId),
      path,
      runId,
    });

  const open = () => {
    const next = normalizeSystemsPath(draft);
    const key = systemsPathKey(environmentId, projectId);
    updatePreferences({
      transform: (current) => ({ systemsPaths: withSystemsPath(current.systemsPaths, key, next) }),
    });
    setDraft(next);
    setPath(next);
    setEditing(null);
    setError(null);
  };

  const run = async (experimentRef: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const response = await createRun({
      environmentId,
      input: { projectId, path, experimentRef, idempotencyKey: uuidv4() },
    });
    setBusy(false);
    if (response._tag === "Failure") {
      setError(failureText(squashAtomCommandFailure(response)));
      return;
    }
    openRun(response.value.runId);
  };

  const problem = error ?? validation.error;
  return (
    <ScrollView
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-6 px-4 pt-4 pb-10"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
    >
      <View className="gap-2">
        <Text textRole="footnote" className="text-foreground-muted">
          Models · experiments · runs · traces
        </Text>
        <View className="flex-row items-center gap-2">
          <AppTextInput
            accessibilityLabel="Systems project folder relative to the project"
            placeholder="Folder with systems.project.json (empty for the root)"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={open}
            className="min-h-11 min-w-0 flex-1 rounded-xl border-continuous bg-card px-3 text-base text-foreground"
          />
          <Button label="Open" onPress={open} />
        </View>
      </View>

      {problem ? <ErrorBanner message={problem} /> : null}
      {validation.isPending && !validation.data ? (
        <Text textRole="footnote" className="text-foreground-muted">
          Validating…
        </Text>
      ) : null}

      {validation.data ? (
        <>
          <Section title={validation.data.name}>
            <SystemsDiagnostics
              diagnostics={validation.data.diagnostics}
              empty="Project is valid."
            />
          </Section>

          <Section title="Compiled entrypoints">
            {compiled.error ? (
              <Text textRole="footnote" className="text-danger-foreground">
                {compiled.error}
              </Text>
            ) : null}
            {compiled.data?.entries.length === 0 ? (
              <Text textRole="footnote" className="text-foreground-muted">
                No entrypoints.
              </Text>
            ) : null}
            {compiled.data?.entries.map((entry) => (
              <Entrypoint
                key={entry.entry}
                entry={entry}
                editing={editing === entry.entry}
                onToggleEditing={() => setEditing(editing === entry.entry ? null : entry.entry)}
              >
                <SystemsParameterEditor
                  environmentId={environmentId}
                  projectId={projectId}
                  path={path}
                  file={entry.entry}
                  onSaved={() => {
                    validation.refresh();
                    compiled.refresh();
                  }}
                />
              </Entrypoint>
            ))}
          </Section>

          <Section title="Experiments">
            {validation.data.experiments.length === 0 ? (
              <Text textRole="footnote" className="text-foreground-muted">
                No *.run.json under experiments/.
              </Text>
            ) : null}
            {validation.data.experiments.map((experimentRef) => (
              <View key={experimentRef} className="flex-row items-center gap-3">
                <Text textRole="footnote" numberOfLines={1} className="min-w-0 flex-1 font-mono">
                  {experimentRef}
                </Text>
                <Button
                  label="Run"
                  tone="primary"
                  accessibilityLabel={`Run ${experimentRef}`}
                  disabled={busy}
                  onPress={() => void run(experimentRef)}
                />
              </View>
            ))}
          </Section>

          <Section title="Runs">
            {live.error ? (
              <Text textRole="footnote" className="text-danger-foreground">
                {live.error}
              </Text>
            ) : null}
            {runs.length === 0 ? (
              <Text textRole="footnote" className="text-foreground-muted">
                No runs yet.
              </Text>
            ) : null}
            {runs.map((item) => (
              <Pressable
                key={item.runId}
                accessibilityRole="button"
                accessibilityLabel={`Open run ${item.experimentId}, ${item.status}`}
                onPress={() => openRun(item.runId)}
                className="gap-1 active:opacity-60"
              >
                <View className="flex-row items-center gap-2">
                  <Text numberOfLines={1} className="min-w-0 shrink font-t3-medium">
                    {item.experimentId}
                  </Text>
                  <SystemsBadge label={item.status} tone={statusTone(item.status)} />
                </View>
                <Text textRole="caption" className="text-foreground-muted">
                  t={formatTime(item.lastCommittedTime)} of {formatTime(item.stop)} s ·{" "}
                  {item.boundaries} boundaries
                </Text>
              </Pressable>
            ))}
          </Section>
        </>
      ) : null}
    </ScrollView>
  );
}

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <ListSection title={props.title}>
      <View className="gap-4 p-4">{props.children}</View>
    </ListSection>
  );
}

function Entrypoint(props: {
  readonly entry: SystemsCompileResult["entries"][number];
  readonly editing: boolean;
  readonly onToggleEditing: () => void;
  readonly children: ReactNode;
}) {
  const { entry } = props;
  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-2">
        <Text textRole="footnote" numberOfLines={1} className="min-w-0 flex-1 font-mono">
          {entry.entry}
        </Text>
        <Chip
          size="small"
          label="Edit parameters"
          selected={props.editing}
          accessibilityLabel={`Edit parameters of ${entry.entry}`}
          onPress={props.onToggleEditing}
        />
      </View>
      {entry.systemId ? <Text textRole="footnote">System {entry.systemId}</Text> : null}
      {entry.semanticDigest ? (
        <Text selectable textRole="caption" className="font-mono text-foreground-muted">
          semantic {entry.semanticDigest}
        </Text>
      ) : null}
      {entry.planDigest ? (
        <Text selectable textRole="caption" className="font-mono text-foreground-muted">
          plan {entry.planDigest}
        </Text>
      ) : null}
      {entry.schedule ? (
        <Text textRole="caption" className="text-foreground-muted">
          {entry.schedule.nodes} nodes · {entry.schedule.charts} charts ·{" "}
          {entry.schedule.clocks
            .map(
              (clock) =>
                `${clock.id} every ${formatTime(clock.period)} s (${clock.steps.length} steps)`,
            )
            .join(", ") || "no clocks"}{" "}
          · continuous {entry.schedule.continuousOrder.join(" → ") || "none"}
        </Text>
      ) : null}
      <SystemsDiagnostics diagnostics={entry.diagnostics} empty="Compiles cleanly." />
      {props.editing ? <View className="pt-2">{props.children}</View> : null}
    </View>
  );
}
