import type { ProjectEntry, ProjectEntryGitStatus } from "@t3tools/contracts";
import { ChevronDownIcon, ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "../lib/utils";
import { basenameOfPath } from "../vscode-icons";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { Switch } from "./ui/switch";
import { createVisibleWorkspaceTreeRows } from "./workspaceTree";

interface SidebarFilesPanelProps {
  entries: readonly ProjectEntry[];
  isLoading: boolean;
  isFetching: boolean;
  truncated: boolean;
  hideDotfiles: boolean;
  selectedRelativePath: string | null;
  theme: "light" | "dark";
  onHideDotfilesChange: (checked: boolean) => void;
  onSelectFile: (relativePath: string) => void;
}

function gitStatusBadge(props: { gitStatus: ProjectEntryGitStatus }) {
  const presentationByStatus: Record<
    ProjectEntryGitStatus,
    { label: string; className: string; title: string }
  > = {
    modified: { label: "M", className: "text-amber-500", title: "Modified" },
    added: { label: "A", className: "text-emerald-500", title: "Added" },
    deleted: { label: "D", className: "text-red-500", title: "Deleted" },
    untracked: { label: "U", className: "text-sky-500", title: "Untracked" },
    renamed: { label: "R", className: "text-violet-500", title: "Renamed" },
    copied: { label: "C", className: "text-cyan-500", title: "Copied" },
    type_changed: { label: "T", className: "text-orange-500", title: "Type changed" },
    conflicted: { label: "!", className: "text-red-500", title: "Conflicted" },
  };

  return presentationByStatus[props.gitStatus];
}

export default function SidebarFilesPanel({
  entries,
  isLoading,
  isFetching,
  truncated,
  hideDotfiles,
  selectedRelativePath,
  theme,
  onHideDotfilesChange,
  onSelectFile,
}: SidebarFilesPanelProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const directoryPaths = new Set(
      entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path),
    );
    setExpandedPaths((current) => {
      const next = new Set<string>();
      for (const expandedPath of current) {
        if (directoryPaths.has(expandedPath)) {
          next.add(expandedPath);
        }
      }
      return next;
    });
  }, [entries]);

  const rows = useMemo(
    () =>
      createVisibleWorkspaceTreeRows(entries, {
        expandedPaths,
        hideDotfiles,
      }),
    [entries, expandedPaths, hideDotfiles],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="sidebar-files-panel">
      <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
        <div className="min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Files
          </span>
          <div className="truncate text-[11px] text-muted-foreground/55">
            {truncated ? "Showing a truncated workspace tree" : "Active thread workspace"}
          </div>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Hide dotfiles</span>
          <Switch
            checked={hideDotfiles}
            onCheckedChange={(checked) => onHideDotfilesChange(Boolean(checked))}
            aria-label="Hide dotfiles"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 px-3 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" />
            Loading workspace files...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center px-3 text-sm text-muted-foreground">
            No files found in this workspace.
          </div>
        ) : (
          <div className="space-y-0.5">
            {rows.map((row) => {
              const isSelected =
                row.entry.kind === "file" && selectedRelativePath === row.entry.path;
              const entryName = basenameOfPath(row.entry.path);
              const statusBadge =
                row.entry.kind === "file" && row.entry.gitStatus
                  ? gitStatusBadge({ gitStatus: row.entry.gitStatus })
                  : null;

              return (
                <button
                  key={`${row.entry.kind}:${row.entry.path}`}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60 hover:text-foreground",
                    isSelected ? "bg-accent text-foreground" : "text-muted-foreground/72",
                  )}
                  style={{ paddingLeft: `${row.depth * 14 + 8}px` }}
                  aria-label={
                    row.entry.kind === "directory"
                      ? `${row.expanded ? "Collapse" : "Expand"} ${entryName} directory`
                      : `Open ${entryName}`
                  }
                  onClick={() => {
                    if (row.entry.kind === "directory") {
                      setExpandedPaths((current) => {
                        const next = new Set(current);
                        if (next.has(row.entry.path)) {
                          next.delete(row.entry.path);
                        } else {
                          next.add(row.entry.path);
                        }
                        return next;
                      });
                      return;
                    }

                    onSelectFile(row.entry.path);
                  }}
                >
                  {row.entry.kind === "directory" ? (
                    row.expanded ? (
                      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
                    ) : (
                      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
                    )
                  ) : (
                    <span className="size-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <VscodeEntryIcon
                    pathValue={row.entry.path}
                    kind={row.entry.kind}
                    theme={theme}
                    className="size-4"
                  />
                  <span className="min-w-0 flex-1 truncate">{entryName}</span>
                  {statusBadge ? (
                    <span
                      className={cn(
                        "shrink-0 font-mono text-[10px] font-medium uppercase",
                        statusBadge.className,
                      )}
                      data-testid={`workspace-file-git-status-${row.entry.path}`}
                      title={statusBadge.title}
                    >
                      {statusBadge.label}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {isFetching && !isLoading ? (
        <div className="border-t border-border px-2 py-1.5 text-xs text-muted-foreground">
          Refreshing workspace tree...
        </div>
      ) : null}
    </div>
  );
}
