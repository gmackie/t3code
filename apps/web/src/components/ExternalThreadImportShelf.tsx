import type {
  ExternalThreadImportDiscoveryResult,
  ExternalThreadImportProviderDiscoveryResult,
  ThreadId,
} from "@t3tools/contracts";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  DownloadIcon,
  LoaderIcon,
  RotateCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { externalThreadImportEnvironment } from "../state/externalThreadImports";
import { useAtomCommand } from "../state/use-atom-command";
import { cn } from "~/lib/utils";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { mergeImportGroups, providerDisplayName } from "./ExternalThreadImportDialog.logic";
import {
  buildExternalThreadImportShelfRows,
  type ExternalThreadImportShelfDiscovery,
  type ExternalThreadImportShelfTarget,
} from "./ExternalThreadImportShelf.logic";
import { stackedThreadToast, toastManager } from "./ui/toast";

interface ExternalThreadImportShelfProps {
  readonly targets: ReadonlyArray<ExternalThreadImportShelfTarget>;
  readonly onOpenThread: (
    environmentId: ExternalThreadImportShelfTarget["environmentId"],
    threadId: ThreadId,
  ) => void;
}

const candidateTitle = (
  candidate: ReturnType<typeof buildExternalThreadImportShelfRows>[number]["candidate"],
): string => candidate.title ?? candidate.firstPromptPreview ?? "Untitled thread";

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Local session discovery failed.";

export function ExternalThreadImportShelf({
  targets,
  onOpenThread,
}: ExternalThreadImportShelfProps) {
  const discover = useAtomCommand(externalThreadImportEnvironment.discover, {
    reportFailure: false,
  });
  const importSelected = useAtomCommand(externalThreadImportEnvironment.importSelected, {
    reportFailure: false,
  });
  const [discoveries, setDiscoveries] = useState<ExternalThreadImportShelfDiscovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [importingToken, setImportingToken] = useState<string | null>(null);
  const [hiddenTokens, setHiddenTokens] = useState<ReadonlySet<string>>(() => new Set());
  const generationRef = useRef(0);
  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    setDiscoveries([]);
    setHiddenTokens(new Set());

    const targetResults = await Promise.all(
      targets.map(async (target) => {
        try {
          let groups: ExternalThreadImportProviderDiscoveryResult[] = [];
          let cursor: ExternalThreadImportDiscoveryResult["nextCursor"];
          const seenCursors = new Set<string>();
          do {
            const result = await discover({
              environmentId: target.environmentId,
              input: {
                environmentId: target.environmentId,
                projectId: target.projectId,
                limit: 200,
                ...(cursor ? { cursor } : {}),
              },
            });
            if (result._tag !== "Success") {
              throw squashAtomCommandFailure(result);
            }
            groups = mergeImportGroups(groups, result.value.providerResults);
            cursor = result.value.nextCursor;
            if (cursor && seenCursors.has(cursor)) break;
            if (cursor) seenCursors.add(cursor);
          } while (cursor);
          return { discovery: { target, groups } satisfies ExternalThreadImportShelfDiscovery };
        } catch (loadError) {
          return { error: loadError };
        }
      }),
    );
    const results = {
      value: targetResults.flatMap((result) => ("discovery" in result ? [result.discovery] : [])),
      errors: targetResults.flatMap((result) => ("error" in result ? [result.error] : [])),
    };

    if (generation !== generationRef.current) return;
    setDiscoveries(results.value);
    setError(results.errors.length > 0 ? failureMessage(results.errors[0]) : null);
    setLoading(false);
  }, [discover, targets]);

  useEffect(() => {
    void load();
    return () => {
      generationRef.current += 1;
    };
  }, [load]);

  const rows = useMemo(
    () =>
      buildExternalThreadImportShelfRows(discoveries).filter(
        (row) => !hiddenTokens.has(row.candidate.token),
      ),
    [discoveries, hiddenTokens],
  );
  const providerFailures = discoveries.flatMap((discovery) =>
    discovery.groups.filter((group) => group._tag === "Failure"),
  );
  const visibleError = error ?? providerFailures[0]?.message ?? null;
  const showShelf = loading || rows.length > 0 || visibleError !== null;

  const importRow = useCallback(
    async (row: (typeof rows)[number]) => {
      if (importingToken !== null) return;
      setImportingToken(row.candidate.token);
      const result = await importSelected({
        environmentId: row.target.environmentId,
        input: {
          environmentId: row.target.environmentId,
          projectId: row.target.projectId,
          tokens: [row.candidate.token],
        },
      });
      setImportingToken(null);
      if (result._tag !== "Success") {
        const importError = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to import thread",
            description: failureMessage(importError),
          }),
        );
        return;
      }
      const outcome = result.value.outcomes[0];
      if (!outcome || outcome._tag === "Failed") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to import thread",
            description: outcome?.message ?? "The provider did not return an imported thread.",
          }),
        );
        return;
      }
      setHiddenTokens((current) => new Set([...current, row.candidate.token]));
      onOpenThread(row.target.environmentId, outcome.threadId);
    },
    [importSelected, importingToken, onOpenThread, rows],
  );

  if (!showShelf) return null;

  return (
    <>
      <li data-thread-selection-safe className="list-none">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          data-testid="sidebar-v2-importable-shelf-toggle"
          className="mb-1 mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
        >
          <span className="text-xs font-medium text-sidebar-muted-foreground/70">
            {expanded ? "Importable" : `Importable (${rows.length})`}
          </span>
          <span className="h-px flex-1 bg-sidebar-border/60" />
          {loading ? (
            <LoaderIcon aria-label="Discovering provider threads" className="size-3 animate-spin" />
          ) : (
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3 text-sidebar-muted-foreground/60 transition-transform",
                expanded && "rotate-180",
              )}
            />
          )}
        </button>
      </li>
      {expanded && visibleError ? (
        <li className="list-none">
          <button
            type="button"
            onClick={() => void load()}
            className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          >
            <CircleAlertIcon className="size-4 shrink-0 text-amber-500" />
            <span className="min-w-0 flex-1 truncate">{visibleError}</span>
            <RotateCwIcon aria-label="Retry discovery" className="size-3.5 shrink-0" />
          </button>
        </li>
      ) : null}
      {expanded
        ? rows.map((row) => {
            const importing = importingToken === row.candidate.token;
            const providerName = providerDisplayName(row.candidate.provider.driver);
            return (
              <li key={`${row.target.environmentId}:${row.candidate.token}`} className="list-none">
                <button
                  type="button"
                  disabled={importingToken !== null}
                  onClick={() => void importRow(row)}
                  className="group/import-row flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground disabled:cursor-wait disabled:opacity-70"
                  aria-label={`Import ${candidateTitle(row.candidate)} from ${providerName}`}
                >
                  <ProviderInstanceIcon
                    driverKind={row.candidate.provider.driver}
                    displayName={providerName}
                    className="size-4"
                    iconClassName="size-4 opacity-70 group-hover/import-row:opacity-100"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{candidateTitle(row.candidate)}</span>
                    <span className="block truncate text-[10px] text-sidebar-muted-foreground/55">
                      {providerName}
                      {row.candidate.turnCount !== undefined
                        ? ` · ${row.candidate.turnCount} turns`
                        : ""}
                    </span>
                  </span>
                  {importing ? (
                    <LoaderIcon aria-label="Importing thread" className="size-3.5 animate-spin" />
                  ) : (
                    <DownloadIcon
                      aria-hidden
                      className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/import-row:opacity-70 group-focus-visible/import-row:opacity-70"
                    />
                  )}
                </button>
              </li>
            );
          })
        : null}
    </>
  );
}
