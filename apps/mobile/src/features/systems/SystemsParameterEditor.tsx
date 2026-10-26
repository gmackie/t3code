import type { EnvironmentId, ProjectId, SystemsModelPatchResult } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  parameterPatch,
  parseParameterDraft,
  semanticChangeSummary,
  systemParameters,
  type SystemsParameter,
} from "@t3tools/client-runtime/systems-parameters";
import { useState } from "react";
import { TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { useEnvironmentQuery } from "../../state/query";
import { systemsEnvironment } from "../../state/systems";
import { useAtomCommand } from "../../state/use-atom-command";
import { failureText, SystemsBadge, SystemsDiagnostics } from "./SystemsDiagnostics";

/** Edits an entrypoint's scalar node parameters; every save is checked and compiled first. */
export function SystemsParameterEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly path: string;
  readonly file: string;
  readonly onSaved: () => void;
}) {
  const { environmentId, projectId, path, file } = props;
  const model = useEnvironmentQuery(
    systemsEnvironment.model({ environmentId, input: { projectId, path, file } }),
  );
  const patchModel = useAtomCommand(systemsEnvironment.patchModel, { reportFailure: false });
  const [texts, setTexts] = useState<ReadonlyMap<string, string>>(new Map());
  const [result, setResult] = useState<SystemsModelPatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (model.error)
    return (
      <Text textRole="footnote" className="text-danger-foreground">
        {model.error}
      </Text>
    );
  if (!model.data)
    return (
      <Text textRole="footnote" className="text-foreground-muted">
        Loading {file}…
      </Text>
    );
  const { revision } = model.data;
  const nodes = systemParameters(model.data.document);
  const parameters = nodes.flatMap((node) => node.editable);
  const parsed = new Map<string, SystemsParameter["value"]>();
  const invalid = new Map<string, string>();
  for (const parameter of parameters) {
    const text = texts.get(parameter.pointer);
    if (text === undefined) continue;
    const outcome = parseParameterDraft(parameter.value, text);
    if ("error" in outcome) invalid.set(parameter.pointer, outcome.error);
    else parsed.set(parameter.pointer, outcome.value);
  }
  const operations = parameterPatch(parameters, parsed);
  const blocked = busy || operations.length === 0 || invalid.size > 0;

  async function submit(dryRun: boolean) {
    if (blocked) return;
    setBusy(true);
    setError(null);
    const response = await patchModel({
      environmentId,
      input: { projectId, path, file, expectedRevision: revision, operations, dryRun },
    });
    setBusy(false);
    if (response._tag === "Failure") {
      setError(failureText(squashAtomCommandFailure(response)));
      return;
    }
    setResult(response.value);
    if (response.value.status === "written") {
      setTexts(new Map());
      model.refresh();
      props.onSaved();
    }
  }

  if (nodes.length === 0)
    return (
      <Text textRole="footnote" className="text-foreground-muted">
        No node parameters.
      </Text>
    );
  return (
    <View className="gap-3">
      {nodes.map((node) => (
        <View key={node.nodeId} className="gap-2 rounded-xl border border-border-subtle p-3">
          <Text textRole="footnote" className="font-mono">
            {node.nodeId} <Text className="text-foreground-muted">{node.nodeType}</Text>
          </Text>
          {node.editable.map((parameter) => {
            const problem = invalid.get(parameter.pointer);
            return (
              <View key={parameter.pointer} className="gap-1">
                <View className="flex-row items-center gap-2">
                  <Text
                    textRole="footnote"
                    numberOfLines={1}
                    className="w-28 shrink-0 font-mono text-foreground-muted"
                  >
                    {parameter.key}
                  </Text>
                  <TextInput
                    accessibilityLabel={`${node.nodeId} ${parameter.key}`}
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={texts.get(parameter.pointer) ?? String(parameter.value)}
                    onChangeText={(text) => setTexts(new Map(texts).set(parameter.pointer, text))}
                    className={cn(
                      "min-h-9 min-w-0 flex-1 rounded-lg border bg-input px-2.5 py-1.5 font-mono text-sm text-foreground",
                      problem ? "border-danger-border" : "border-input-border",
                    )}
                  />
                </View>
                {problem ? (
                  <Text textRole="caption" className="text-danger-foreground">
                    {problem}
                  </Text>
                ) : null}
              </View>
            );
          })}
          {node.fixed.map((entry) => (
            <Text
              key={entry.key}
              textRole="caption"
              numberOfLines={1}
              className="font-mono text-foreground-muted"
            >
              {entry.key} {entry.json}
            </Text>
          ))}
        </View>
      ))}
      <View className="flex-row flex-wrap items-center gap-2">
        <Button label="Check" disabled={blocked} onPress={() => void submit(true)} />
        <Button
          label={operations.length > 0 ? `Save (${operations.length})` : "Save"}
          tone="primary"
          disabled={blocked}
          loading={busy}
          onPress={() => void submit(false)}
        />
        {operations.length > 0 ? (
          <Button label="Revert" tone="text" disabled={busy} onPress={() => setTexts(new Map())} />
        ) : null}
      </View>
      {error ? (
        <Text selectable textRole="footnote" className="text-danger-foreground">
          {error}
        </Text>
      ) : null}
      {result ? (
        <View className="gap-1">
          <SystemsBadge
            label={result.status === "dry_run" ? "checks pass" : result.status}
            tone={result.status === "rejected" ? "error" : "success"}
          />
          {semanticChangeSummary(result.semanticDiff).map((line) => (
            <Text key={line} textRole="footnote" className="text-foreground-muted">
              {line}
            </Text>
          ))}
          <SystemsDiagnostics diagnostics={result.diagnostics} empty="" />
        </View>
      ) : null}
    </View>
  );
}
