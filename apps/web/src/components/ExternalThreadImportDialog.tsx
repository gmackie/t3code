import type {
  EnvironmentId,
  ExternalThreadImportCandidate,
  ExternalThreadImportDiscoveryResult,
  ExternalThreadImportOutcome,
  ExternalThreadImportProviderDiscoveryResult,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { LoaderIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { externalThreadImportEnvironment } from "../state/externalThreadImports";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  buildImportRows,
  createExternalThreadImportDialogRequestGuard,
  filterImportGroups,
  mergeImportPage,
  openImportedThread,
  providerDisplayName,
  retryImportDiscovery,
  selectedAvailableTokens,
} from "./ExternalThreadImportDialog.logic";

export interface ExternalThreadImportTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectTitle: string;
}

interface ExternalThreadImportDialogProps {
  readonly target: ExternalThreadImportTarget | null;
  readonly onClose: () => void;
  readonly onOpenThread: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "The request could not be completed.";

const candidateTitle = (candidate: ExternalThreadImportCandidate): string =>
  candidate.title ?? candidate.firstPromptPreview ?? candidate.nativeThreadId ?? "Untitled thread";

export function ExternalThreadImportDialog({
  target,
  onClose,
  onOpenThread,
}: ExternalThreadImportDialogProps) {
  const discover = useAtomCommand(externalThreadImportEnvironment.discover, {
    reportFailure: false,
  });
  const importSelected = useAtomCommand(externalThreadImportEnvironment.importSelected, {
    reportFailure: false,
  });
  const [discovery, setDiscovery] = useState<{
    readonly groups: ReadonlyArray<ExternalThreadImportProviderDiscoveryResult>;
    readonly selected: Set<string>;
  }>({ groups: [], selected: new Set() });
  const [query, setQuery] = useState("");
  const [outcomes, setOutcomes] = useState<ExternalThreadImportOutcome[]>([]);
  const [nextCursor, setNextCursor] = useState<ExternalThreadImportDiscoveryResult["nextCursor"]>();
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGuard = useRef(createExternalThreadImportDialogRequestGuard());
  const activeGeneration = useRef(0);

  const closeDialog = useCallback(() => {
    requestGuard.current.invalidate();
    onClose();
  }, [onClose]);

  const load = useCallback(
    async (
      requestTarget: ExternalThreadImportTarget,
      generation: number,
      cursor?: ExternalThreadImportDiscoveryResult["nextCursor"],
    ) => {
      const targetKey = `${requestTarget.environmentId}:${requestTarget.projectId}`;
      const cursorKey = cursor ?? "initial";
      if (!requestGuard.current.tryStartLoad(generation, targetKey, cursorKey)) return;
      setLoading(true);
      setError(null);
      const result = await discover({
        environmentId: requestTarget.environmentId,
        input: {
          environmentId: requestTarget.environmentId,
          projectId: requestTarget.projectId,
          limit: 200,
          ...(cursor ? { cursor } : {}),
        },
      });
      if (!requestGuard.current.finishLoad(generation, targetKey, cursorKey)) return;
      setLoading(false);
      if (result._tag === "Success") {
        setDiscovery((current) =>
          cursor
            ? mergeImportPage(current.groups, result.value.providerResults, current.selected)
            : { groups: result.value.providerResults, selected: new Set() },
        );
        setNextCursor(result.value.nextCursor);
        return;
      }
      setError(errorMessage(squashAtomCommandFailure(result)));
    },
    [discover],
  );

  useEffect(() => {
    if (!target) {
      requestGuard.current.invalidate();
      return;
    }
    const targetKey = `${target.environmentId}:${target.projectId}`;
    const generation = requestGuard.current.activate(targetKey);
    activeGeneration.current = generation;
    setDiscovery({ groups: [], selected: new Set() });
    setQuery("");
    setOutcomes([]);
    setNextCursor(undefined);
    setLoading(false);
    setImporting(false);
    setError(null);
    void load(target, generation);
    return () => {
      if (requestGuard.current.isCurrent(generation, targetKey)) requestGuard.current.invalidate();
    };
  }, [load, target]);

  const groups = discovery.groups;
  const selected = discovery.selected;
  const successfulGroups = groups.filter((group) => group._tag === "Success");
  const candidates = successfulGroups.flatMap((group) => group.candidates);
  const filteredGroups = useMemo(() => filterImportGroups(groups, query), [groups, query]);
  const rows = buildImportRows(candidates, outcomes);
  const outcomeByToken = new Map(rows.map((row) => [row.candidate.token, row.outcome]));
  const tokens = selectedAvailableTokens(selected, candidates);

  const submit = useCallback(async () => {
    if (!target || tokens.length === 0) return;
    const targetKey = `${target.environmentId}:${target.projectId}`;
    const generation = activeGeneration.current;
    if (!requestGuard.current.tryStartImport(generation, targetKey)) return;
    setImporting(true);
    setError(null);
    const result = await importSelected({
      environmentId: target.environmentId,
      input: {
        environmentId: target.environmentId,
        projectId: target.projectId,
        tokens,
      },
    });
    if (!requestGuard.current.finishImport(generation, targetKey)) return;
    setImporting(false);
    if (result._tag !== "Success") {
      setError(errorMessage(squashAtomCommandFailure(result)));
      return;
    }
    setOutcomes((current) => {
      const replaced = new Map(current.map((outcome) => [outcome.token, outcome]));
      for (const outcome of result.value.outcomes) replaced.set(outcome.token, outcome);
      return [...replaced.values()];
    });
    setDiscovery((current) => {
      const next = new Set(current.selected);
      for (const outcome of result.value.outcomes) {
        if (outcome._tag !== "Failed") next.delete(outcome.token);
      }
      return { ...current, selected: next };
    });
    const firstImported = result.value.outcomes.find(
      (outcome) => outcome._tag === "Imported" || outcome._tag === "AlreadyImported",
    );
    if (firstImported && result.value.outcomes.every((outcome) => outcome._tag !== "Failed")) {
      openImportedThread({
        environmentId: target.environmentId,
        threadId: firstImported.threadId,
        onClose: closeDialog,
        onOpenThread,
      });
    }
  }, [closeDialog, importSelected, onOpenThread, target, tokens]);

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && closeDialog()}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import threads</DialogTitle>
          <DialogDescription>
            Continue Claude, Codex, or Grok Build sessions in{" "}
            {target?.projectTitle ?? "this project"}.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Search threads"
              className="pl-9"
              placeholder="Search sessions, prompts, or paths"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
            {loading && groups.length === 0 ? (
              <div
                role="status"
                className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"
              >
                <LoaderIcon className="size-4 animate-spin" /> Discovering local sessions…
              </div>
            ) : null}
            {!loading && groups.length === 0 && !error ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No Claude, Codex, or Grok Build sessions were found for this project.
              </p>
            ) : null}
            {groups.length > 0 && filteredGroups.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No sessions match “{query}”.
              </p>
            ) : null}
            {filteredGroups.map((group) => (
              <section
                key={`${group.provider.driver}:${group.provider.instanceId}:${group._tag}`}
                className="space-y-2"
              >
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {providerDisplayName(group.provider.driver)}
                  {String(group.provider.instanceId) !== String(group.provider.driver)
                    ? ` · ${group.provider.instanceId}`
                    : ""}
                </h3>
                {group._tag === "Failure" ? (
                  <div className="rounded-md border border-destructive/30 p-3 text-sm">
                    <p>{group.message}</p>
                    {group.retryable ? (
                      <Button
                        className="mt-2"
                        size="sm"
                        variant="outline"
                        disabled={loading || !nextCursor || !target}
                        onClick={() =>
                          target &&
                          retryImportDiscovery({
                            target,
                            generation: activeGeneration.current,
                            cursor: nextCursor,
                            load: (retryTarget, generation, cursor) => {
                              void load(retryTarget, generation, cursor);
                            },
                          })
                        }
                      >
                        Retry
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="divide-y rounded-md border">
                    {group.candidates.map((candidate) => {
                      const alreadyImported = candidate.status._tag === "AlreadyImported";
                      const outcome = outcomeByToken.get(candidate.token);
                      const importedThreadId =
                        outcome?._tag === "Imported" || outcome?._tag === "AlreadyImported"
                          ? outcome.threadId
                          : alreadyImported
                            ? candidate.status.threadId
                            : undefined;
                      return (
                        <div key={candidate.token} className="flex gap-3 p-3">
                          <Checkbox
                            aria-label={`Select ${candidateTitle(candidate)}`}
                            checked={selected.has(candidate.token)}
                            disabled={alreadyImported || importedThreadId !== undefined}
                            onCheckedChange={(checked) =>
                              setDiscovery((current) => {
                                const next = new Set(current.selected);
                                if (checked) next.add(candidate.token);
                                else next.delete(candidate.token);
                                return { ...current, selected: next };
                              })
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {candidateTitle(candidate)}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {candidate.originalCwd}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {[
                                candidate.turnCount != null ? `${candidate.turnCount} turns` : null,
                                candidate.messageCount != null
                                  ? `${candidate.messageCount} messages`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                            {outcome?._tag === "Failed" ? (
                              <p className="mt-1 text-xs text-destructive">{outcome.message}</p>
                            ) : null}
                          </div>
                          {importedThreadId ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                target &&
                                openImportedThread({
                                  environmentId: target.environmentId,
                                  threadId: importedThreadId,
                                  onClose: closeDialog,
                                  onOpenThread,
                                })
                              }
                            >
                              Open
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
            {nextCursor ? (
              <Button
                className="w-full"
                variant="outline"
                disabled={loading}
                onClick={() => target && void load(target, activeGeneration.current, nextCursor)}
              >
                {loading ? "Loading…" : "Load more"}
              </Button>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={closeDialog}>
            Cancel
          </Button>
          <Button disabled={tokens.length === 0 || importing} onClick={() => void submit()}>
            {importing
              ? "Importing…"
              : `Import${tokens.length > 0 ? ` ${tokens.length}` : " selected"}`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
