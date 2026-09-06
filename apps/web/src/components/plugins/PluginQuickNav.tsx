import type { EnvironmentId, PluginRegistryEntry } from "@t3tools/contracts";
import { listPluginQuickNavFromEntries } from "@t3tools/client-runtime/plugins";
import { ExternalLinkIcon, PanelsTopLeftIcon } from "lucide-react";
import { useMemo } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { pluginEnvironment } from "../../state/plugins";
import { cn } from "~/lib/utils";

type PluginQuickNavProps = {
  environmentId: EnvironmentId;
  projectId?: string;
  threadId: string;
};

export function PluginQuickNav({ environmentId, projectId, threadId }: PluginQuickNavProps) {
  const query = useEnvironmentQuery(pluginEnvironment.list({ environmentId, input: {} }));
  const items = useMemo(
    () =>
      listPluginQuickNavFromEntries(query.data ?? ([] as readonly PluginRegistryEntry[]), {
        ...(projectId ? { projectId } : {}),
        threadId,
      }).filter((item) => item.surface === undefined || item.surface === "thread.sidePanel"),
    [projectId, query.data, threadId],
  );

  if (items.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-1" data-plugin-quick-nav>
      {items.map((item) => (
        <a
          key={`${item.pluginId}:${item.kind}:${item.id}`}
          href={item.href}
          className={cn(
            "inline-flex max-w-40 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground",
            "hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          )}
          title={`${item.displayName}: ${item.title}`}
          aria-label={`Open ${item.displayName} ${item.title}`}
        >
          {item.kind === "panel" ? (
            <PanelsTopLeftIcon className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
          )}
          <span className="truncate">{item.title}</span>
        </a>
      ))}
    </div>
  );
}
