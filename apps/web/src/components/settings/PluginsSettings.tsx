import { CheckIcon, CircleAlertIcon, PowerIcon, ShieldCheckIcon } from "lucide-react";
import { useMemo } from "react";
import { useAtomRefresh } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { Link } from "@tanstack/react-router";

import type { PluginCapabilityRequest, PluginSettingValueMap } from "@t3tools/contracts";
import type { ClientSettingsPatch } from "@t3tools/contracts/settings";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironment } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { pluginEnvironment } from "../../state/plugins";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { PluginSettingsForm } from "./PluginSettingsForm";

const EMPTY_PLUGIN_REFRESH_ATOM = Atom.make(0);

function capabilityLabel(capability: PluginCapabilityRequest): string {
  switch (capability.kind) {
    case "events.read":
      return `Read events${capability.eventTypes.length ? ` (${capability.eventTypes.join(", ")})` : ""}`;
    case "threads.read":
      return "Read T3 threads";
    case "threads.dispatch":
      return "Dispatch T3 threads";
    case "filesystem.read":
    case "filesystem.write":
      return `${capability.kind} (${capability.roots.join(", ")})`;
    case "secrets.read":
      return `Read secrets (${capability.names.join(", ")})`;
    case "network.connect":
      return `Connect to ${capability.hosts.join(", ")}`;
    case "ui.embed":
      return `Embed UI (${capability.surfaces.join(", ")})`;
    case "provider.control":
      return "Control provider instances";
  }
}

function PluginCapabilities({
  capabilities,
}: {
  capabilities: readonly PluginCapabilityRequest[];
}) {
  return (
    <ul
      className="mt-2 space-y-1 text-xs text-muted-foreground"
      aria-label="Requested capabilities"
    >
      {capabilities.map((capability) => (
        <li
          key={`${capability.kind}:${JSON.stringify(capability)}`}
          className="flex items-start gap-1.5"
        >
          <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" />
          <span>{capabilityLabel(capability)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PluginsSettingsPanel() {
  const environment = usePrimaryEnvironment();
  const projects = useProjects();
  const primarySettings = usePrimarySettings();
  const updatePrimarySettings = useUpdatePrimarySettings();
  const target = environment ? { environmentId: environment.environmentId, input: {} } : null;
  const listAtom = target ? pluginEnvironment.list(target) : null;
  const plugins = useEnvironmentQuery(listAtom);
  const refreshPlugins = useAtomRefresh(
    (listAtom ?? EMPTY_PLUGIN_REFRESH_ATOM) as unknown as NonNullable<typeof listAtom>,
  );
  const enable = useAtomCommand(pluginEnvironment.enable, { reportFailure: false });
  const disable = useAtomCommand(pluginEnvironment.disable, { reportFailure: false });
  const grant = useAtomCommand(pluginEnvironment.grant, { reportFailure: false });
  const enabledIds = useMemo(
    () =>
      new Set(
        (plugins.data ?? [])
          .filter((plugin) => plugin.health.state === "healthy")
          .map((plugin) => plugin.pluginId),
      ),
    [plugins.data],
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="Plugins" icon={<PowerIcon className="size-4" />}>
        <SettingsRow
          title="Installed plugins"
          description="Plugins run as independent applications. Review their requested capabilities before enabling them."
          status={
            plugins.error ?? (environment ? null : "Connect an environment to manage plugins.")
          }
        >
          {plugins.isPending ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">Loading plugins…</div>
          ) : null}
          {!plugins.isPending && plugins.data?.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
              No plugins are installed yet. Raw Git and curated repository installation will appear
              here after review.
            </div>
          ) : null}
          <div className="space-y-2">
            {plugins.data?.map((plugin) => {
              const enabled = enabledIds.has(plugin.pluginId);
              const clientSettings = plugin.settings.filter(
                (setting) => setting.scope === "client" && setting.storage?.kind === "client",
              );
              const clientValues = Object.fromEntries(
                clientSettings.flatMap((setting) => {
                  const key = setting.storage?.kind === "client" ? setting.storage.key : undefined;
                  const value =
                    key === undefined
                      ? undefined
                      : primarySettings[key as keyof typeof primarySettings];
                  return typeof value === "string" ||
                    typeof value === "number" ||
                    typeof value === "boolean"
                    ? [[setting.id, value]]
                    : [];
                }),
              ) as PluginSettingValueMap;
              const onClientValuesChange = (values: PluginSettingValueMap) => {
                const patch = Object.fromEntries(
                  clientSettings.flatMap((setting) => {
                    const key =
                      setting.storage?.kind === "client" ? setting.storage.key : undefined;
                    const value = values[setting.id];
                    return key !== undefined && value !== undefined ? [[key, value]] : [];
                  }),
                ) as ClientSettingsPatch;
                updatePrimarySettings(patch);
              };
              return (
                <div key={plugin.pluginId} className="rounded-xl border border-border/70 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-medium">{plugin.displayName}</h3>
                        <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                        {plugin.health.state === "healthy" ? (
                          <CheckIcon className="size-3.5 text-emerald-500" />
                        ) : null}
                        {plugin.health.state === "crashed" ? (
                          <CircleAlertIcon className="size-3.5 text-destructive" />
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {plugin.pluginId} · {plugin.source.kind}
                      </p>
                      <PluginCapabilities capabilities={plugin.capabilities} />
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {plugin.capabilities.map((capability) => {
                          const granted = plugin.grants.some(
                            (item) => JSON.stringify(item) === JSON.stringify(capability),
                          );
                          return (
                            <Button
                              key={JSON.stringify(capability)}
                              size="xs"
                              variant={granted ? "outline" : "secondary"}
                              disabled={!environment || granted}
                              onClick={() => {
                                if (!environment) return;
                                void grant({
                                  environmentId: environment.environmentId,
                                  input: { pluginId: plugin.pluginId, capability },
                                }).then(() => refreshPlugins());
                              }}
                            >
                              {granted
                                ? `Granted: ${capability.kind}`
                                : `Grant: ${capability.kind}`}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {plugin.navigation.length > 0 ? (
                        <Link
                          to="/plugins/$pluginId"
                          params={{ pluginId: plugin.pluginId }}
                          className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          Open workspace
                        </Link>
                      ) : null}
                      {environment ? (
                        <Button
                          size="xs"
                          variant={enabled ? "outline" : "default"}
                          onClick={() => {
                            const action = enabled ? disable : enable;
                            void action({
                              environmentId: environment.environmentId,
                              input: { pluginId: plugin.pluginId },
                            }).then(() => refreshPlugins());
                          }}
                        >
                          {enabled ? "Disable" : "Enable"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {environment && plugin.settings.length > 0 ? (
                    <div className="mt-4 border-t border-border/60 pt-3">
                      {plugin.settingsPanels.length > 0 ? (
                        plugin.settingsPanels.map((panel) => (
                          <PluginSettingsForm
                            key={panel.id}
                            environmentId={environment.environmentId}
                            plugin={plugin}
                            projects={projects}
                            settingIds={panel.settingIds}
                            title={panel.title}
                            {...(panel.description !== undefined
                              ? { description: panel.description }
                              : {})}
                            clientValues={clientValues}
                            onClientValuesChange={onClientValuesChange}
                          />
                        ))
                      ) : (
                        <PluginSettingsForm
                          environmentId={environment.environmentId}
                          plugin={plugin}
                          projects={projects}
                          clientValues={clientValues}
                          onClientValuesChange={onClientValuesChange}
                        />
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </SettingsRow>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
