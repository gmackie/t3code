import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, IssueItem, ProjectId, ProjectIssueStatus } from "@t3tools/contracts";
import { ClipboardListIcon, KanbanIcon, ListIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildIssueThreadDraftPrompt } from "./Sidebar.logic";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Input } from "./ui/input";
import { SidebarInset, SidebarTrigger } from "./ui/sidebar";
import { Textarea } from "./ui/textarea";
import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { readLocalApi } from "../localApi";
import { inferProjectTitleFromPath } from "../lib/projectPaths";
import { cn } from "../lib/utils";
import {
  groupIssuesByStatus,
  resolveProjectIssueKeyBadgeClassName,
  resolveProjectIssueProviderBadgeClassName,
  resolveProjectIssueStatusBadgeClassName,
  resolveSelectableIssueStatuses,
  shouldRenderCreateIssueModal,
  type ProjectIssueViewMode,
} from "../projectIssues.logic";
import { usePrimarySettings } from "../hooks/useSettings";
import { useProjects } from "../state/entities";

interface ProjectIssueViewerProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

const DEFAULT_CREATE_STATUS = "Backlog";

function IssueCard(props: {
  readonly issue: IssueItem;
  readonly statusOptions: readonly ProjectIssueStatus[];
  readonly updatingIssueId: string | null;
  readonly onStartThread: (issue: IssueItem) => void;
  readonly onUpdateStatus: (issue: IssueItem, status: ProjectIssueStatus) => void;
}) {
  const { issue, onStartThread, onUpdateStatus, statusOptions, updatingIssueId } = props;
  const currentStatus = issue.statusName ?? issue.state;
  const currentStatusId = issue.statusId ?? currentStatus;

  return (
    <article className="rounded-xl border border-border/70 bg-card/65 p-4 shadow-sm/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={resolveProjectIssueKeyBadgeClassName(issue)}>{issue.key}</span>
            <span className={resolveProjectIssueStatusBadgeClassName(issue)}>{currentStatus}</span>
          </div>
          <h3 className="line-clamp-2 font-semibold text-sm text-foreground">{issue.title}</h3>
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            {issue.assigneeName ? <span>Assigned to {issue.assigneeName}</span> : null}
            {issue.labels.length > 0 ? <span>{issue.labels.join(", ")}</span> : null}
          </div>
          {issue.descriptionMarkdown ? (
            <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground text-sm">
              {issue.descriptionMarkdown}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          aria-label={`Update status for ${issue.key}`}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          value={currentStatusId}
          disabled={updatingIssueId === issue.id}
          onChange={(event) => {
            const selectedStatus = statusOptions.find(
              (status) => status.id === event.currentTarget.value,
            );
            if (selectedStatus) {
              onUpdateStatus(issue, selectedStatus);
            }
          }}
        >
          {statusOptions.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={() => onStartThread(issue)}>
          Start thread
        </Button>
      </div>
    </article>
  );
}

export function ProjectIssueViewer({ environmentId, projectId }: ProjectIssueViewerProps) {
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const projects = useProjects();
  const project = projects.find(
    (candidate) =>
      candidate.environmentId === projectRef.environmentId && candidate.id === projectRef.projectId,
  );
  const projectTitle = project ? inferProjectTitleFromPath(project.workspaceRoot) : "";
  const linearSettings = usePrimarySettings((settings) => settings.issues.linear);
  const mapping = linearSettings.projectMappings[projectId] ?? null;
  const handleNewThread = useNewThreadHandler();
  const [viewMode, setViewMode] = useState<ProjectIssueViewMode>("list");
  const [issues, setIssues] = useState<readonly IssueItem[]>([]);
  const [statuses, setStatuses] = useState<readonly ProjectIssueStatus[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createIssueOpen, setCreateIssueOpen] = useState(false);
  const [updatingIssueId, setUpdatingIssueId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newStatusId, setNewStatusId] = useState<string>("");

  const statusOptions = useMemo(() => {
    return resolveSelectableIssueStatuses({ statuses, issues });
  }, [issues, statuses]);
  const statusGroups = useMemo(() => groupIssuesByStatus(issues), [issues]);

  useEffect(() => {
    if (!statusOptions.some((status) => status.id === newStatusId)) {
      setNewStatusId(statusOptions[0]?.id ?? DEFAULT_CREATE_STATUS);
    }
  }, [newStatusId, statusOptions]);

  const loadIssues = useCallback(
    (nextQuery: string = query) => {
      const api = readLocalApi();
      if (!api) {
        setIssues([]);
        setError("Local backend is unavailable.");
        return;
      }
      setLoading(true);
      setError(null);
      void api.server
        .listProjectIssues({
          projectId,
          ...(nextQuery.trim().length > 0 ? { query: nextQuery.trim() } : {}),
          limit: 100,
        })
        .then((result) => setIssues(result.issues))
        .catch((loadError) => {
          setIssues([]);
          setError(loadError instanceof Error ? loadError.message : "Unable to load issues.");
        })
        .finally(() => setLoading(false));
    },
    [projectId, query],
  );

  const loadStatuses = useCallback(() => {
    const api = readLocalApi();
    if (!api) {
      setStatuses([]);
      setError("Local backend is unavailable.");
      return;
    }
    setError(null);
    void api.server
      .listProjectIssueStatuses({ projectId })
      .then((result) => setStatuses(result.statuses))
      .catch((loadError) => {
        setStatuses([]);
        setError(loadError instanceof Error ? loadError.message : "Unable to load issue statuses.");
      });
  }, [projectId]);

  useEffect(() => {
    loadIssues("");
    loadStatuses();
  }, [loadIssues, loadStatuses]);

  const createIssue = useCallback(() => {
    const title = newTitle.trim();
    if (!title) return;
    const api = readLocalApi();
    if (!api) {
      setError("Local backend is unavailable.");
      return;
    }
    setCreating(true);
    setError(null);
    const selectedStatus = statusOptions.find((status) => status.id === newStatusId);
    void api.server
      .createProjectIssue({
        projectId,
        title,
        ...(newDescription.trim().length > 0 ? { descriptionMarkdown: newDescription.trim() } : {}),
        ...(selectedStatus
          ? { statusId: selectedStatus.id, statusName: selectedStatus.name }
          : { statusName: DEFAULT_CREATE_STATUS }),
      })
      .then((result) => {
        setIssues((current) => [
          result.issue,
          ...current.filter((issue) => issue.id !== result.issue.id),
        ]);
        setNewTitle("");
        setNewDescription("");
        setCreateIssueOpen(false);
      })
      .catch((createError) => {
        setError(createError instanceof Error ? createError.message : "Unable to create issue.");
      })
      .finally(() => setCreating(false));
  }, [newDescription, newStatusId, newTitle, projectId, statusOptions]);

  const updateIssueStatus = useCallback(
    (issue: IssueItem, status: ProjectIssueStatus) => {
      if ((issue.statusId ?? issue.statusName ?? issue.state) === status.id) return;
      const api = readLocalApi();
      if (!api) {
        setError("Local backend is unavailable.");
        return;
      }
      setUpdatingIssueId(issue.id);
      setError(null);
      void api.server
        .updateProjectIssueStatus({
          projectId,
          issueId: issue.id,
          statusId: status.id,
          statusName: status.name,
        })
        .then((result) => {
          setIssues((current) =>
            current.map((candidate) =>
              candidate.id === result.issue.id ? result.issue : candidate,
            ),
          );
        })
        .catch((updateError) => {
          setError(updateError instanceof Error ? updateError.message : "Unable to update issue.");
        })
        .finally(() => setUpdatingIssueId(null));
    },
    [projectId],
  );

  const startThreadForIssue = useCallback(
    (issue: IssueItem) => {
      void handleNewThread(projectRef, {
        branch: issue.suggestedBranchName ?? null,
        envMode: "local",
      }).then(() => {
        const draftThread = useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef);
        if (draftThread) {
          useComposerDraftStore
            .getState()
            .setPrompt(draftThread.draftId, buildIssueThreadDraftPrompt(issue));
        }
      });
    },
    [handleNewThread, projectRef],
  );

  if (!project) {
    return (
      <SidebarInset className="h-dvh min-h-0 bg-background text-foreground">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Project not found</EmptyTitle>
            <EmptyDescription>
              This project is no longer available in the current environment.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }

  if (!mapping) {
    return (
      <SidebarInset className="h-dvh min-h-0 bg-background text-foreground">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No linked issue project</EmptyTitle>
            <EmptyDescription>
              Assign this project to a Linear project before viewing issues.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="border-b border-border/80 px-3 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ClipboardListIcon className="size-4 text-muted-foreground" />
                  <h1 className="truncate font-semibold text-base text-foreground">
                    {projectTitle}
                  </h1>
                  <span className={resolveProjectIssueProviderBadgeClassName()}>
                    {mapping.teamKey || mapping.linearProjectName}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground text-xs">
                  {mapping.linearProjectName} issues
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={viewMode === "list" ? "default" : "outline"}
                onClick={() => setViewMode("list")}
              >
                <ListIcon className="size-3.5" />
                List
              </Button>
              <Button
                size="sm"
                variant={viewMode === "kanban" ? "default" : "outline"}
                onClick={() => setViewMode("kanban")}
              >
                <KanbanIcon className="size-3.5" />
                Kanban
              </Button>
              <Button size="sm" onClick={() => setCreateIssueOpen(true)}>
                <PlusIcon className="size-3.5" />
                Create issue
              </Button>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
          <section className="mb-4 flex flex-wrap items-center gap-2">
            <Input
              nativeInput
              value={query}
              placeholder="Search issues"
              aria-label="Search project issues"
              className="max-w-sm"
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") loadIssues(query);
              }}
            />
            <Button variant="outline" onClick={() => loadIssues(query)} disabled={loading}>
              <RefreshCwIcon className={cn("size-4", loading ? "animate-spin" : "")} />
              Refresh
            </Button>
          </section>

          {error ? (
            <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive text-sm">
              {error}
            </div>
          ) : null}

          {loading && issues.length === 0 ? (
            <div className="rounded-xl border border-border/70 px-4 py-8 text-center text-muted-foreground text-sm">
              Loading issues...
            </div>
          ) : issues.length === 0 ? (
            <div className="rounded-xl border border-border/70 px-4 py-8 text-center text-muted-foreground text-sm">
              No linked issues found.
            </div>
          ) : viewMode === "list" ? (
            <div className="grid gap-3">
              {issues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  statusOptions={statusOptions}
                  updatingIssueId={updatingIssueId}
                  onStartThread={startThreadForIssue}
                  onUpdateStatus={updateIssueStatus}
                />
              ))}
            </div>
          ) : (
            <div className="grid min-w-[720px] grid-cols-3 gap-3 xl:grid-cols-4">
              {statusGroups.map((group) => (
                <section
                  key={group.label}
                  className="min-w-0 rounded-2xl border border-border/70 bg-card/35 p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="truncate font-semibold text-sm">{group.label}</h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                      {group.issues.length}
                    </span>
                  </div>
                  <div className="grid gap-3">
                    {group.issues.map((issue) => (
                      <IssueCard
                        key={issue.id}
                        issue={issue}
                        statusOptions={statusOptions}
                        updatingIssueId={updatingIssueId}
                        onStartThread={startThreadForIssue}
                        onUpdateStatus={updateIssueStatus}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </main>
      </div>
      <Dialog
        open={shouldRenderCreateIssueModal(createIssueOpen)}
        onOpenChange={(open) => setCreateIssueOpen(open)}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create Linear issue</DialogTitle>
            <DialogDescription>
              Add a new issue to {mapping.linearProjectName} and choose its initial workflow status.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3">
            <Input
              nativeInput
              value={newTitle}
              placeholder="New issue title"
              aria-label="New issue title"
              onChange={(event) => setNewTitle(event.currentTarget.value)}
            />
            <select
              aria-label="New issue status"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              value={newStatusId}
              onChange={(event) => setNewStatusId(event.currentTarget.value)}
            >
              {statusOptions.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
            <Textarea
              value={newDescription}
              placeholder="Optional issue description"
              aria-label="New issue description"
              onChange={(event) => setNewDescription(event.currentTarget.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateIssueOpen(false)}>
              Cancel
            </Button>
            <Button disabled={creating || !newTitle.trim()} onClick={createIssue}>
              <PlusIcon className="size-4" />
              Create issue
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </SidebarInset>
  );
}
