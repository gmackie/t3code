import { useState } from "react";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { systemsEnvironment } from "~/state/systems";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { randomUUID } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { SystemsRunDetail } from "./SystemsRunDetail";
import { formatTime as format, statusTone } from "@t3tools/client-runtime/systems-presentation";
import { Diagnostics } from "./SystemsDiagnostics";
import { SystemsParameterEditor } from "./SystemsParameterEditor";

const pathKey = (environmentId: string, projectId: string) =>
  `t3:systems-path:${environmentId}:${projectId}`;

export function SystemsWorkspace({
  threadRef,
  projectId,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly projectId: ProjectId | null;
}) {
  if (!projectId)
    return <p className="p-4 text-sm">Open a project thread to work with a systems model.</p>;
  return (
    <ProjectSystems
      key={`${threadRef.environmentId}:${projectId}`}
      environmentId={threadRef.environmentId}
      projectId={projectId}
    />
  );
}

function ProjectSystems({
  environmentId,
  projectId,
}: {
  readonly environmentId: ScopedThreadRef["environmentId"];
  readonly projectId: ProjectId;
}) {
  const [draft, setDraft] = useState(
    () => localStorage.getItem(pathKey(environmentId, projectId)) ?? "",
  );
  const [path, setPath] = useState(draft);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
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
  const selected = runs.find((run) => run.runId === selectedRun) ?? null;

  const open = () => {
    const next = draft.trim().replace(/^\/+|\/+$/g, "");
    localStorage.setItem(pathKey(environmentId, projectId), next);
    setPath(next);
    setSelectedRun(null);
    setEditing(null);
  };

  async function run(experimentRef: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await createRun({
        environmentId,
        input: { projectId, path, experimentRef, idempotencyKey: randomUUID() },
      });
      if (response._tag === "Failure") throw squashAtomCommandFailure(response);
      setSelectedRun(response.value.runId);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Systems workspace"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <header className="border-b border-border p-3">
        <h2 className="text-sm font-semibold">Systems Workbench</h2>
        <p className="text-xs text-muted-foreground">Models · experiments · runs · traces</p>
      </header>
      <form
        className="flex gap-2 border-b border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          open();
        }}
      >
        <Input
          aria-label="Systems project folder relative to the project"
          placeholder="Folder with systems.project.json (empty for the project root)"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" size="sm">
          Open
        </Button>
      </form>
      {(error ?? validation.error) && (
        <p role="alert" className="p-3 text-xs text-destructive">
          {error ?? validation.error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {validation.data && (
          <div className="space-y-4 p-3 text-xs">
            <div>
              <h3 className="font-semibold">{validation.data.name}</h3>
              <Diagnostics diagnostics={validation.data.diagnostics} empty="Project is valid." />
            </div>
            <div>
              <h3 className="font-semibold">Compiled entrypoints</h3>
              {compiled.error && <p className="text-destructive">{compiled.error}</p>}
              {compiled.data?.entries.map((entry) => (
                <div key={entry.entry} className="mt-2 rounded-md border border-border p-2">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate font-mono">{entry.entry}</p>
                    <Button
                      size="xs"
                      variant={editing === entry.entry ? "secondary" : "ghost"}
                      aria-expanded={editing === entry.entry}
                      onClick={() => setEditing(editing === entry.entry ? null : entry.entry)}
                    >
                      Edit parameters
                    </Button>
                  </div>
                  {entry.systemId && <p>System {entry.systemId}</p>}
                  {entry.semanticDigest && (
                    <p className="break-all font-mono text-muted-foreground">
                      semantic {entry.semanticDigest}
                    </p>
                  )}
                  {entry.planDigest && (
                    <p className="break-all font-mono text-muted-foreground">
                      plan {entry.planDigest}
                    </p>
                  )}
                  {entry.schedule && (
                    <p className="text-muted-foreground">
                      {entry.schedule.nodes} nodes · {entry.schedule.charts} charts ·{" "}
                      {entry.schedule.clocks
                        .map(
                          (clock) =>
                            `${clock.id} every ${format(clock.period)} s (${clock.steps.length} steps)`,
                        )
                        .join(", ") || "no clocks"}{" "}
                      · continuous {entry.schedule.continuousOrder.join(" → ") || "none"}
                    </p>
                  )}
                  <Diagnostics diagnostics={entry.diagnostics} empty="Compiles cleanly." />
                  {editing === entry.entry && (
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
                  )}
                </div>
              ))}
            </div>
            <div>
              <h3 className="font-semibold">Experiments</h3>
              {!validation.data.experiments.length && (
                <p className="text-muted-foreground">No *.run.json under experiments/.</p>
              )}
              <ul className="mt-1 space-y-1">
                {validation.data.experiments.map((experimentRef) => (
                  <li key={experimentRef} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono">{experimentRef}</span>
                    <Button size="xs" disabled={busy} onClick={() => void run(experimentRef)}>
                      Run
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold">Runs</h3>
              {live.error && <p className="text-destructive">{live.error}</p>}
              {!runs.length && <p className="text-muted-foreground">No runs yet.</p>}
              <ul className="mt-1 space-y-1">
                {runs.map((item) => (
                  <li key={item.runId} className="flex items-center gap-2">
                    <Button
                      size="xs"
                      variant={item.runId === selected?.runId ? "secondary" : "ghost"}
                      onClick={() => setSelectedRun(item.runId)}
                    >
                      {item.experimentId}
                    </Button>
                    <Badge variant={statusTone(item.status)}>{item.status}</Badge>
                    <span className="text-muted-foreground">
                      t={format(item.lastCommittedTime)} of {format(item.stop)} s ·{" "}
                      {item.boundaries} boundaries
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {selected && (
          <SystemsRunDetail key={selected.runId} environmentId={environmentId} run={selected} />
        )}
      </div>
    </section>
  );
}
