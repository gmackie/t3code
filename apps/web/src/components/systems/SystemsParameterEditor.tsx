import { useState } from "react";
import type { EnvironmentId, ProjectId, SystemsModelPatchResult } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  parameterPatch,
  parseParameterDraft,
  semanticChangeSummary,
  systemParameters,
  type SystemsParameter,
} from "@t3tools/client-runtime/systems-parameters";
import { systemsEnvironment } from "~/state/systems";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Diagnostics } from "./SystemsDiagnostics";

/** Edits an entrypoint's scalar node parameters; every save is checked and compiled first. */
export function SystemsParameterEditor({
  environmentId,
  projectId,
  path,
  file,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly path: string;
  readonly file: string;
  readonly onSaved: () => void;
}) {
  const model = useEnvironmentQuery(
    systemsEnvironment.model({ environmentId, input: { projectId, path, file } }),
  );
  const patchModel = useAtomCommand(systemsEnvironment.patchModel, { reportFailure: false });
  const [texts, setTexts] = useState<ReadonlyMap<string, string>>(new Map());
  const [result, setResult] = useState<SystemsModelPatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (model.error) return <p className="text-destructive">{model.error}</p>;
  if (!model.data) return <p className="text-muted-foreground">Loading {file}…</p>;
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

  async function submit(dryRun: boolean) {
    if (busy || operations.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await patchModel({
        environmentId,
        input: { projectId, path, file, expectedRevision: revision, operations, dryRun },
      });
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      setResult(response.value);
      if (response.value.status === "written") {
        setTexts(new Map());
        model.refresh();
        onSaved();
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (nodes.length === 0) return <p className="text-muted-foreground">No node parameters.</p>;
  return (
    <div className="mt-2 space-y-2">
      {nodes.map((node) => (
        <fieldset key={node.nodeId} className="rounded-md border border-border p-2">
          <legend className="px-1 font-mono">
            {node.nodeId} <span className="text-muted-foreground">{node.nodeType}</span>
          </legend>
          {node.editable.map((parameter) => (
            <label key={parameter.pointer} className="mt-1 flex items-center gap-2">
              <span className="w-28 shrink-0 truncate font-mono">{parameter.key}</span>
              <Input
                size="sm"
                aria-invalid={invalid.has(parameter.pointer)}
                value={texts.get(parameter.pointer) ?? String(parameter.value)}
                onChange={(event) =>
                  setTexts(new Map(texts).set(parameter.pointer, event.target.value))
                }
              />
              {invalid.has(parameter.pointer) && (
                <span className="shrink-0 text-destructive">{invalid.get(parameter.pointer)}</span>
              )}
            </label>
          ))}
          {node.fixed.map((entry) => (
            <p key={entry.key} className="mt-1 truncate font-mono text-muted-foreground">
              {entry.key} {entry.json}
            </p>
          ))}
        </fieldset>
      ))}
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={busy || operations.length === 0 || invalid.size > 0}
          onClick={() => void submit(true)}
        >
          Check
        </Button>
        <Button
          size="xs"
          disabled={busy || operations.length === 0 || invalid.size > 0}
          onClick={() => void submit(false)}
        >
          Save {operations.length > 0 ? `(${operations.length})` : ""}
        </Button>
        {operations.length > 0 && (
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => setTexts(new Map())}>
            Revert
          </Button>
        )}
      </div>
      {error && <p className="text-destructive">{error}</p>}
      {result && (
        <div>
          <Badge variant={result.status === "rejected" ? "error" : "success"}>
            {result.status === "dry_run" ? "checks pass" : result.status}
          </Badge>
          {semanticChangeSummary(result.semanticDiff).map((line) => (
            <p key={line} className="text-muted-foreground">
              {line}
            </p>
          ))}
          <Diagnostics diagnostics={result.diagnostics} empty="" />
        </div>
      )}
    </div>
  );
}
