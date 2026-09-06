import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  PuzzleIcon,
  RefreshCwIcon,
} from "lucide-react";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useEnvironmentQuery } from "../state/query";
import { usePrimaryEnvironment } from "../state/environments";
import { pluginEnvironment } from "../state/plugins";
import { useAtomCommand } from "../state/use-atom-command";
import type { PluginPanelModel, PluginSurfaceModel, PluginWorkflowModel } from "@t3tools/contracts";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { SidebarInset } from "../components/ui/sidebar";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/plugins/$pluginId")({
  component: PluginWorkspaceRoute,
});

function PluginWorkspaceRoute() {
  const { pluginId } = Route.useParams();
  const location = useLocation();
  const environment = usePrimaryEnvironment();
  const target = environment ? { environmentId: environment.environmentId, input: {} } : null;
  const plugins = useEnvironmentQuery(target ? pluginEnvironment.list(target) : null);
  const plugin = plugins.data?.find((entry) => entry.pluginId === pluginId);
  const navigation = plugin?.navigation ?? [];
  const currentPath = new URLSearchParams(location.search).get("section") || "/";
  const navigationItem =
    navigation.find((item) => (item.path || "/") === currentPath) ?? navigation[0];
  const requestedPanelId = new URLSearchParams(location.search).get("panel");
  const requestedWorkflowId = new URLSearchParams(location.search).get("workflow");
  const selectedPanel = plugin?.panels.find((panel) => panel.id === requestedPanelId);
  const selectedWorkflow = plugin?.workflows.find(
    (workflow) => workflow.id === requestedWorkflowId,
  );
  const surfaceTarget =
    target && plugin && navigationItem && !selectedPanel && !selectedWorkflow
      ? {
          environmentId: target.environmentId,
          input: { pluginId, navigationId: navigationItem.id },
        }
      : null;
  const surface = useEnvironmentQuery(
    surfaceTarget ? pluginEnvironment.surfaceGet(surfaceTarget) : null,
  );
  const panelTarget =
    target && plugin && selectedPanel
      ? { environmentId: target.environmentId, input: { pluginId, panelId: selectedPanel.id } }
      : null;
  const panel = useEnvironmentQuery(panelTarget ? pluginEnvironment.panelGet(panelTarget) : null);
  const workflowTarget =
    target && plugin && selectedWorkflow
      ? {
          environmentId: target.environmentId,
          input: { pluginId, workflowId: selectedWorkflow.id },
        }
      : null;
  const workflow = useEnvironmentQuery(
    workflowTarget ? pluginEnvironment.workflowGet(workflowTarget) : null,
  );
  const runPluginAction = useAtomCommand(pluginEnvironment.action, { reportFailure: false });
  const runWorkflowAction = useAtomCommand(pluginEnvironment.workflowAction, {
    reportFailure: false,
  });

  if (plugins.isPending) {
    return (
      <PluginWorkspaceFrame>
        <div className="p-6 text-sm text-muted-foreground">Loading plugin workspace…</div>
      </PluginWorkspaceFrame>
    );
  }

  if (!plugin) {
    return (
      <PluginWorkspaceFrame>
        <div className="mx-auto flex max-w-xl flex-col items-start gap-4 p-6">
          <Link
            to="/settings/plugins"
            className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" /> Back to plugins
          </Link>
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Plugin unavailable</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {plugins.error ?? `The plugin “${pluginId}” is not installed in this environment.`}
            </CardContent>
          </Card>
        </div>
      </PluginWorkspaceFrame>
    );
  }

  const healthy = plugin.health.state === "healthy";
  return (
    <PluginWorkspaceFrame>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="border-b border-border/70 bg-background/90 px-5 py-4 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1400px] items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <PuzzleIcon className="size-3.5" /> Plugin workspace
              </div>
              <h1 className="mt-2 truncate text-xl font-semibold tracking-tight">
                {plugin.displayName}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {plugin.pluginId} · v{plugin.version}
              </p>
            </div>
            <Badge variant={healthy ? "secondary" : "outline"} className="shrink-0 gap-1.5">
              {healthy ? (
                <CircleCheckIcon className="size-3.5" />
              ) : (
                <AlertTriangleIcon className="size-3.5" />
              )}
              {plugin.health.state}
            </Badge>
          </div>
        </header>

        <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col md:flex-row">
          <nav
            aria-label={`${plugin.displayName} navigation`}
            className="border-b border-border/70 p-3 md:w-56 md:border-b-0 md:border-r"
          >
            <div className="flex gap-1 overflow-x-auto md:flex-col">
              {navigation.map((item) => {
                const path = item.path.startsWith("/") ? item.path : `/${item.path}`;
                const active =
                  currentPath === path || (path !== "/" && currentPath.startsWith(`${path}/`));
                return (
                  <a
                    key={item.id}
                    href={`/plugins/${encodeURIComponent(plugin.pluginId)}?section=${encodeURIComponent(path)}`}
                    className={cn(
                      "whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {item.title}
                  </a>
                );
              })}
              {plugin.panels.length > 0 ? (
                <div className="mt-3 border-t border-border/60 pt-3 md:mt-4">
                  <div className="px-3 pb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Panels
                  </div>
                  {plugin.panels.map((panelContribution) => (
                    <a
                      key={panelContribution.id}
                      href={`/plugins/${encodeURIComponent(plugin.pluginId)}?panel=${encodeURIComponent(panelContribution.id)}`}
                      className={cn(
                        "block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                        selectedPanel?.id === panelContribution.id &&
                          "bg-accent text-accent-foreground",
                      )}
                    >
                      {panelContribution.title}
                    </a>
                  ))}
                </div>
              ) : null}
              {plugin.workflows.length > 0 ? (
                <div className="mt-3 border-t border-border/60 pt-3 md:mt-4">
                  <div className="px-3 pb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Review workflows
                  </div>
                  {plugin.workflows.map((workflowContribution) => (
                    <a
                      key={workflowContribution.id}
                      href={`/plugins/${encodeURIComponent(plugin.pluginId)}?workflow=${encodeURIComponent(workflowContribution.id)}`}
                      className={cn(
                        "block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                        selectedWorkflow?.id === workflowContribution.id &&
                          "bg-accent text-accent-foreground",
                      )}
                    >
                      {workflowContribution.title}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </nav>

          <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6">
            <div className="mx-auto grid max-w-5xl gap-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle>
                      {selectedWorkflow?.title ??
                        selectedPanel?.title ??
                        navigationItem?.title ??
                        "Overview"}
                    </CardTitle>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={selectedWorkflow ? workflow.isPending : surface.isPending}
                      onClick={selectedWorkflow ? workflow.refresh : surface.refresh}
                    >
                      <RefreshCwIcon
                        className={cn(
                          "size-3.5",
                          (selectedWorkflow ? workflow.isPending : surface.isPending) &&
                            "animate-spin",
                        )}
                      />
                      Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedWorkflow ? (
                    <PluginWorkflowContent
                      workflow={workflow.data}
                      pending={workflow.isPending}
                      error={workflow.error}
                      onAction={(actionId) => {
                        if (!environment) return;
                        void runWorkflowAction({
                          environmentId: environment.environmentId,
                          input: {
                            pluginId,
                            workflowId: selectedWorkflow.id,
                            actionId,
                            input: {},
                          },
                        }).then(() => workflow.refresh());
                      }}
                    />
                  ) : selectedPanel ? (
                    <PluginPanelContent
                      panel={panel.data}
                      pending={panel.isPending}
                      error={panel.error}
                      onAction={(actionId) => {
                        if (!environment) return;
                        void runPluginAction({
                          environmentId: environment.environmentId,
                          input: { pluginId, actionId, input: {} },
                        });
                      }}
                    />
                  ) : (
                    <PluginSurfaceContent
                      surface={surface.data}
                      pending={surface.isPending}
                      error={surface.error}
                      onAction={(actionId) => {
                        if (!navigationItem || !environment) return;
                        void runPluginAction({
                          environmentId: environment.environmentId,
                          input: { pluginId, actionId, navigationId: navigationItem.id, input: {} },
                        });
                      }}
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Granted integration context</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Runtime
                    </div>
                    <div className="mt-1">{plugin.health.state}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Capabilities
                    </div>
                    <div className="mt-1">{plugin.capabilities.length} requested</div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </main>
        </div>
      </div>
    </PluginWorkspaceFrame>
  );
}

function PluginWorkflowContent({
  workflow,
  pending,
  error,
  onAction,
}: {
  workflow: PluginWorkflowModel | null;
  pending: boolean;
  error: string | null;
  onAction: (actionId: string) => void;
}) {
  if (pending)
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading workflow…</div>;
  if (error)
    return (
      <div className="rounded-lg border border-dashed border-border/80 p-8 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  if (!workflow)
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">No workflow data yet.</div>
    );
  return (
    <div className="grid gap-4">
      <div className="text-xs text-muted-foreground">
        Current stage: <span className="font-medium text-foreground">{workflow.currentStage}</span>
        <span className="ml-2">· Updated {new Date(workflow.refreshedAt).toLocaleString()}</span>
      </div>
      <div className="grid gap-2">
        {workflow.steps.map((step) => (
          <div
            key={step.id}
            className="flex items-start gap-3 rounded-lg border border-border/70 p-3"
          >
            <div
              className={cn(
                "mt-0.5 size-2.5 shrink-0 rounded-full",
                step.state === "completed" && "bg-emerald-500",
                step.state === "active" && "bg-blue-500",
                step.state === "failed" && "bg-red-500",
                step.state === "blocked" && "bg-amber-500",
                step.state === "pending" && "bg-muted-foreground/40",
              )}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span>{step.title}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {step.state}
                </span>
              </div>
              {step.detail ? (
                <div className="mt-1 text-xs text-muted-foreground">{step.detail}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {workflow.evidence?.length ? (
        <div className="grid gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Evidence
          </div>
          {workflow.evidence.map((evidence) => (
            <div key={evidence.id} className="rounded-lg border border-border/70 p-3">
              <div className="flex items-center justify-between gap-3 text-sm font-medium">
                <span>{evidence.title}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {evidence.status} · {evidence.kind}
                </span>
              </div>
              {evidence.detail ? (
                <div className="mt-1 text-xs text-muted-foreground">{evidence.detail}</div>
              ) : null}
              {evidence.url ? (
                <a
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  href={evidence.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open evidence <ExternalLinkIcon className="size-3.5" />
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <SurfaceActions actions={workflow.actions} onAction={onAction} />
    </div>
  );
}

function PluginSurfaceContent({
  surface,
  pending,
  error,
  onAction,
}: {
  surface: PluginSurfaceModel | null;
  pending: boolean;
  error: string | null;
  onAction: (actionId: string) => void;
}) {
  if (pending)
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">Loading plugin surface…</div>
    );
  if (error) {
    return (
      <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-8 text-center">
        <p className="text-sm font-medium">Surface unavailable</p>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!surface)
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">No surface data yet.</div>
    );
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        Updated {new Date(surface.refreshedAt).toLocaleString()}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {surface.cards.map((card) => {
          if (card.kind === "metric") {
            return (
              <div key={card.id} className="rounded-lg border border-border/70 p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {card.title}
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-tight">{card.value}</div>
                {card.detail ? (
                  <div className="mt-1 text-xs text-muted-foreground">{card.detail}</div>
                ) : null}
                <SurfaceActions actions={card.actions} onAction={onAction} />
              </div>
            );
          }
          if (card.kind === "notice") {
            return (
              <div
                key={card.id}
                className="rounded-lg border border-border/70 p-4 sm:col-span-2 lg:col-span-3"
              >
                <div className="text-sm font-medium">{card.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">{card.message}</div>
                <SurfaceActions actions={card.actions} onAction={onAction} />
              </div>
            );
          }
          return (
            <div
              key={card.id}
              className="rounded-lg border border-border/70 p-4 sm:col-span-2 lg:col-span-3"
            >
              <div className="text-sm font-medium">{card.title}</div>
              <div className="mt-3 divide-y divide-border/60">
                {card.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate">{item.title}</div>
                      {item.detail ? (
                        <div className="truncate text-xs text-muted-foreground">{item.detail}</div>
                      ) : null}
                    </div>
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLinkIcon className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PluginPanelContent({
  panel,
  pending,
  error,
  onAction,
}: {
  panel: PluginPanelModel | null;
  pending: boolean;
  error: string | null;
  onAction: (actionId: string) => void;
}) {
  if (pending)
    return <div className="p-8 text-center text-sm text-muted-foreground">Loading panel…</div>;
  if (error)
    return (
      <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-8 text-center text-sm text-muted-foreground">
        {error}
      </div>
    );
  if (!panel)
    return <div className="p-8 text-center text-sm text-muted-foreground">No panel data yet.</div>;
  if (panel.content.kind === "serial-console") {
    return (
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>{panel.content.target}</span>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {panel.content.connection}
          </span>
        </div>
        <pre className="max-h-[min(60vh,520px)] overflow-auto rounded-lg bg-black/80 p-4 font-mono text-xs leading-5 text-emerald-200">
          {panel.content.lines
            .map((line) => `${line.timestamp} [${line.stream}] ${line.text}`)
            .join("\n") || "No console output yet."}
        </pre>
        <SurfaceActions actions={panel.content.actions} onAction={onAction} />
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-border/70 p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
        <div className="mt-2 text-lg font-semibold">{panel.content.status}</div>
        <div className="mt-1 text-sm text-muted-foreground">{panel.content.summary}</div>
      </div>
      <div className="divide-y divide-border/60 rounded-lg border border-border/70">
        {panel.content.runs.map((run) => (
          <div key={run.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div>
              <div>{run.title}</div>
              {run.detail ? (
                <div className="text-xs text-muted-foreground">{run.detail}</div>
              ) : null}
            </div>
            <span className="text-xs text-muted-foreground">{run.status}</span>
          </div>
        ))}
      </div>
      <SurfaceActions actions={panel.content.actions} onAction={onAction} />
    </div>
  );
}

function SurfaceActions({
  actions,
  onAction,
}: {
  actions:
    | readonly {
        id: string;
        title: string;
        tone?: "primary" | "secondary" | "destructive" | undefined;
      }[]
    | undefined;
  onAction: (actionId: string) => void;
}) {
  if (!actions?.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action.id}
          size="xs"
          variant={
            action.tone === "destructive"
              ? "destructive"
              : action.tone === "primary"
                ? "default"
                : "outline"
          }
          onClick={() => onAction(action.id)}
        >
          {action.title}
        </Button>
      ))}
    </div>
  );
}

function PluginWorkspaceFrame({ children }: { children: ReactNode }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      {children}
    </SidebarInset>
  );
}
