import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  ExternalThreadImportCandidate,
  ExternalThreadImportDiscoveryResult,
  ProjectSessionImportRepository,
  ProjectSessionImportScanResult,
} from "@t3tools/contracts";
import { DEFAULT_MODEL, ProviderInstanceId } from "@t3tools/contracts";
import { FolderSearchIcon, LoaderIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readLocalApi } from "../localApi";
import { inferProjectTitleFromPath } from "../lib/projectPaths";
import { newProjectId } from "../lib/utils";
import { useProjects } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { externalThreadImportEnvironment } from "../state/externalThreadImports";
import { projectEnvironment } from "../state/projects";
import { projectSessionImportEnvironment } from "../state/projectSessionImports";
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

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Repository discovery failed.";

const candidateIdentity = (candidate: ExternalThreadImportCandidate) =>
  `${candidate.provider.driver}:${candidate.provider.instanceId}:${candidate.nativeThreadId}`;

export function mergeExternalThreadImportCandidates(
  current: readonly ExternalThreadImportCandidate[],
  incoming: readonly ExternalThreadImportCandidate[],
): ExternalThreadImportCandidate[] {
  const merged = new Map(current.map((candidate) => [candidateIdentity(candidate), candidate]));
  for (const candidate of incoming) {
    for (const [identity, existing] of merged) {
      if (existing.token === candidate.token) merged.delete(identity);
    }
    merged.set(candidateIdentity(candidate), candidate);
  }
  return [...merged.values()];
}

export function ProjectSessionImportWizard(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly initialRoot?: string;
  readonly onScanComplete?: (repositoryCount: number) => void;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const scan = useAtomCommand(projectSessionImportEnvironment.scan, { reportFailure: false });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const discoverSessions = useAtomCommand(externalThreadImportEnvironment.discover, {
    reportFailure: false,
  });
  const importSessions = useAtomCommand(externalThreadImportEnvironment.importSelected, {
    reportFailure: false,
  });
  const [root, setRoot] = useState("~/");
  const [repositories, setRepositories] = useState<ProjectSessionImportRepository[]>([]);
  const [selectedRoots, setSelectedRoots] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [scannedDirectoryCount, setScannedDirectoryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sessionRows, setSessionRows] = useState<
    Array<{
      readonly repository: ProjectSessionImportRepository;
      readonly projectId: ReturnType<typeof newProjectId>;
      readonly candidates: readonly ExternalThreadImportCandidate[];
    }>
  >([]);
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [importedCount, setImportedCount] = useState(0);
  const generation = useRef(0);
  const selectedCandidateCount = useMemo(
    () =>
      sessionRows.reduce(
        (count, row) =>
          count +
          row.candidates.filter(
            (candidate) =>
              candidate.status._tag === "Available" && selectedTokens.has(candidate.token),
          ).length,
        0,
      ),
    [selectedTokens, sessionRows],
  );

  useEffect(() => {
    if (props.open && props.initialRoot) setRoot(props.initialRoot);
  }, [props.initialRoot, props.open]);

  const chooseRoot = useCallback(async () => {
    const picked = await readLocalApi()
      ?.dialogs.pickFolder({ initialPath: root })
      .catch(() => null);
    if (picked) setRoot(picked);
  }, [root]);

  const startScan = useCallback(async () => {
    if (!environmentId) {
      setError("The local environment is not connected.");
      return;
    }
    const activeGeneration = ++generation.current;
    setScanning(true);
    setError(null);
    setRepositories([]);
    setSelectedRoots(new Set());
    setScannedDirectoryCount(0);
    setSessionRows([]);
    setSelectedTokens(new Set());
    setImportedCount(0);
    let cursor: ProjectSessionImportScanResult["nextCursor"];
    let repositoryCount = 0;
    do {
      const result = await scan({
        environmentId,
        input: { environmentId, root, limit: 100, ...(cursor ? { cursor } : {}) },
      });
      if (generation.current !== activeGeneration) return;
      if (result._tag !== "Success") {
        setError(errorMessage(squashAtomCommandFailure(result)));
        setScanning(false);
        return;
      }
      setRepositories((current) => [...current, ...result.value.repositories]);
      repositoryCount += result.value.repositories.length;
      setSelectedRoots((current) => {
        const next = new Set(current);
        for (const repository of result.value.repositories) next.add(repository.root);
        return next;
      });
      setScannedDirectoryCount(result.value.scannedDirectoryCount);
      cursor = result.value.nextCursor;
    } while (cursor);
    setScanning(false);
    props.onScanComplete?.(repositoryCount);
  }, [environmentId, props.onScanComplete, root, scan]);

  const reviewSessions = useCallback(async () => {
    if (!environmentId) return;
    const activeGeneration = ++generation.current;
    setReviewing(true);
    setError(null);
    setSessionRows([]);
    setSelectedTokens(new Set());
    const rows: Array<{
      repository: ProjectSessionImportRepository;
      projectId: ReturnType<typeof newProjectId>;
      candidates: ExternalThreadImportCandidate[];
    }> = [];
    for (const repository of repositories.filter((item) => selectedRoots.has(item.root))) {
      const existing = projects.find(
        (project) =>
          project.environmentId === environmentId && project.workspaceRoot === repository.root,
      );
      const projectId = existing?.id ?? newProjectId();
      if (!existing) {
        const result = await createProject({
          environmentId,
          input: {
            projectId,
            title: inferProjectTitleFromPath(repository.root),
            workspaceRoot: repository.root,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: DEFAULT_MODEL,
            },
          },
        });
        if (result._tag !== "Success") {
          setError(errorMessage(squashAtomCommandFailure(result)));
          setReviewing(false);
          return;
        }
      }
      let candidates: ExternalThreadImportCandidate[] = [];
      rows.push({ repository, projectId, candidates });
      setSessionRows(rows.map((row) => ({ ...row, candidates: [...row.candidates] })));
      let cursor: ExternalThreadImportDiscoveryResult["nextCursor"] = undefined;
      do {
        const result = await discoverSessions({
          environmentId,
          input: { environmentId, projectId, limit: 200, ...(cursor ? { cursor } : {}) },
        });
        if (generation.current !== activeGeneration) return;
        if (result._tag !== "Success") {
          setError(errorMessage(squashAtomCommandFailure(result)));
          setReviewing(false);
          return;
        }
        const incoming = result.value.providerResults.flatMap((providerResult) =>
          providerResult._tag === "Success" ? providerResult.candidates : [],
        );
        candidates = mergeExternalThreadImportCandidates(candidates, incoming);
        rows[rows.length - 1]!.candidates = candidates;
        setSessionRows(rows.map((row) => ({ ...row, candidates: [...row.candidates] })));
        setSelectedTokens((current) => {
          const next = new Set(current);
          for (const candidate of candidates) {
            if (candidate.status._tag === "Available") next.add(candidate.token);
          }
          return next;
        });
        cursor = result.value.nextCursor;
      } while (cursor);
    }
    setReviewing(false);
  }, [createProject, discoverSessions, environmentId, projects, repositories, selectedRoots]);

  const importSelected = useCallback(async () => {
    if (!environmentId) return;
    setImporting(true);
    setError(null);
    let completed = 0;
    for (const row of sessionRows) {
      const tokens = row.candidates
        .filter(
          (candidate) =>
            candidate.status._tag === "Available" && selectedTokens.has(candidate.token),
        )
        .map((candidate) => candidate.token);
      for (let offset = 0; offset < tokens.length; offset += 200) {
        const result = await importSessions({
          environmentId,
          input: {
            environmentId,
            projectId: row.projectId,
            tokens: tokens.slice(offset, offset + 200),
          },
        });
        if (result._tag !== "Success") {
          setError(errorMessage(squashAtomCommandFailure(result)));
          setImporting(false);
          return;
        }
        completed += result.value.outcomes.filter(
          (outcome) => outcome._tag === "Imported" || outcome._tag === "AlreadyImported",
        ).length;
        setImportedCount(completed);
      }
    }
    setImporting(false);
  }, [environmentId, importSessions, selectedTokens, sessionRows]);

  const close = useCallback(() => {
    generation.current += 1;
    setScanning(false);
    props.onOpenChange(false);
  }, [props]);

  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}>
      <DialogPopup className="max-h-[80vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import projects and sessions</DialogTitle>
          <DialogDescription>
            Scan a folder for Git projects, then choose the Claude, Codex, and Grok sessions to
            bring into T3 Code.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4 overflow-y-auto">
          <div className="flex gap-2">
            <Input
              aria-label="Scan root"
              value={root}
              onChange={(event) => setRoot(event.target.value)}
            />
            <Button type="button" variant="outline" onClick={chooseRoot}>
              Choose…
            </Button>
            <Button type="button" onClick={startScan} disabled={scanning || !root.trim()}>
              {scanning ? <LoaderIcon className="animate-spin" /> : <FolderSearchIcon />}
              Scan
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {scanning
              ? `Scanned ${scannedDirectoryCount.toLocaleString()} folders…`
              : repositories.length > 0
                ? `${repositories.length} Git projects found. All are selected by default.`
                : "The default root is your home folder. Choose /Volumes/dev when you want that workspace."}
          </p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="space-y-1">
            {sessionRows.length === 0
              ? repositories.map((repository) => (
                  <label
                    key={repository.root}
                    className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-accent"
                  >
                    <Checkbox
                      checked={selectedRoots.has(repository.root)}
                      onCheckedChange={(checked) =>
                        setSelectedRoots((current) => {
                          const next = new Set(current);
                          if (checked) next.add(repository.root);
                          else next.delete(repository.root);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {repository.name}
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                          {projects.some(
                            (project) =>
                              project.environmentId === environmentId &&
                              project.workspaceRoot === repository.root,
                          )
                            ? "In T3 Code"
                            : "New"}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {repository.root}
                      </span>
                    </span>
                  </label>
                ))
              : sessionRows.map((row) => (
                  <div key={row.repository.root} className="rounded-md border p-3">
                    <div className="mb-2 text-sm font-medium">{row.repository.name}</div>
                    {row.candidates.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No matching provider sessions found.
                      </p>
                    ) : (
                      row.candidates.map((candidate) => (
                        <label
                          key={candidate.token}
                          className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-accent"
                        >
                          <Checkbox
                            checked={selectedTokens.has(candidate.token)}
                            disabled={reviewing || candidate.status._tag === "AlreadyImported"}
                            onCheckedChange={(checked) =>
                              setSelectedTokens((current) => {
                                const next = new Set(current);
                                if (checked) next.add(candidate.token);
                                else next.delete(candidate.token);
                                return next;
                              })
                            }
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm">
                              {candidate.title ??
                                candidate.firstPromptPreview ??
                                candidate.nativeThreadId ??
                                "Untitled thread"}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {candidate.provider.driver} ·{" "}
                              {candidate.messageCount ?? candidate.turnCount ?? 0} messages
                              {candidate.status._tag === "AlreadyImported"
                                ? " · already imported"
                                : ""}
                            </span>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                ))}
          </div>
          {importedCount > 0 ? (
            <p className="text-sm text-success">Imported {importedCount} sessions.</p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          {sessionRows.length === 0 ? (
            <Button
              disabled={selectedRoots.size === 0 || scanning || reviewing}
              onClick={reviewSessions}
            >
              {reviewing ? <LoaderIcon className="animate-spin" /> : null}
              Review sessions
            </Button>
          ) : (
            <Button
              disabled={selectedCandidateCount === 0 || reviewing || importing}
              onClick={importSelected}
            >
              {reviewing || importing ? <LoaderIcon className="animate-spin" /> : null}
              Import {selectedCandidateCount} sessions
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
