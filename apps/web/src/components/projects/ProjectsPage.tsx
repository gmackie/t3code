import type { ProjectSource } from "@t3tools/contracts";
import { FolderGit2Icon, FolderPlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useCallback, useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { readLocalApi } from "../../localApi";
import { projectSourceFromRoot } from "../../projectLibrary";
import { ProjectSessionImportWizard } from "../ProjectSessionImportWizard";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";

export function ProjectsPage() {
  const sources = usePrimarySettings((settings) => settings.projectSources);
  const updateSettings = useUpdatePrimarySettings();
  const [root, setRoot] = useState("~/");
  const [activeSource, setActiveSource] = useState<ProjectSource | null>(null);

  const addRoot = useCallback(
    (nextRoot: string) => {
      const source = projectSourceFromRoot(nextRoot);
      const nextSources = [...sources.filter((item) => item.root !== source.root), source];
      updateSettings({ projectSources: nextSources });
      setActiveSource(source);
    },
    [sources, updateSettings],
  );

  const chooseRoot = useCallback(async () => {
    const picked = await readLocalApi()
      ?.dialogs.pickFolder({ initialPath: root })
      .catch(() => null);
    if (picked) {
      setRoot(picked);
      addRoot(picked);
    }
  }, [addRoot, root]);

  return (
    <ScrollArea className="h-full">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:gap-7 sm:px-6 sm:py-8">
        <header>
          <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Add a folder once. T3 Code finds its Git repositories and lets you bring over external
            agent histories for review in native threads.
          </p>
        </header>

        <section className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="mb-3 flex items-center gap-2 font-medium">
            <FolderPlusIcon className="size-4" /> Add project folder
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Project source folder"
              value={root}
              onChange={(event) => setRoot(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && root.trim()) addRoot(root);
              }}
            />
            <Button variant="outline" onClick={chooseRoot}>
              Choose…
            </Button>
            <Button disabled={!root.trim()} onClick={() => addRoot(root)}>
              Add and scan
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Scanning stops at each Git repository and does not descend into submodules.
          </p>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Folders</h2>
            <span className="text-xs text-muted-foreground">{sources.length} saved</span>
          </div>
          {sources.length === 0 ? (
            <div className="rounded-xl border border-dashed px-6 py-12 text-center">
              <FolderGit2Icon className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="font-medium">No project folders yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Start with your home folder, or choose /Volumes/dev for your development workspace.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="flex flex-col items-stretch gap-3 border-b px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
                >
                  <FolderGit2Icon className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{source.label}</div>
                    <div className="truncate text-xs text-muted-foreground">{source.root}</div>
                  </div>
                  <div className="hidden text-right text-xs text-muted-foreground sm:block">
                    {source.lastRepositoryCount > 0
                      ? `${source.lastRepositoryCount} repositories last found`
                      : "Ready to scan"}
                  </div>
                  <Button
                    className="w-full sm:w-auto"
                    size="sm"
                    variant="outline"
                    onClick={() => setActiveSource(source)}
                  >
                    <RefreshCwIcon /> Scan & import
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${source.label}`}
                    onClick={() =>
                      updateSettings({
                        projectSources: sources.filter((item) => item.id !== source.id),
                      })
                    }
                  >
                    <span className="sr-only">Remove</span>
                    <span aria-hidden="true">×</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <ProjectSessionImportWizard
        open={activeSource !== null}
        {...(activeSource ? { initialRoot: activeSource.root } : {})}
        onOpenChange={(open) => {
          if (!open) setActiveSource(null);
        }}
        onScanComplete={(repositoryCount) => {
          if (!activeSource) return;
          updateSettings({
            projectSources: sources.map((source) =>
              source.id === activeSource.id
                ? { ...source, lastRepositoryCount: repositoryCount }
                : source,
            ),
          });
        }}
      />
    </ScrollArea>
  );
}
