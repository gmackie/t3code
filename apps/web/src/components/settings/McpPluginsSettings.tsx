import { useAtomRefresh } from "@effect/atom-react";
import type { EnvironmentId, McpPluginEntry, McpServerVariable } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { mcpPluginEnvironment } from "../../state/mcpApps";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const EMPTY_PLUGINS: ReadonlyArray<McpPluginEntry> = [];

const reportFailure = (title: string, result: AtomCommandResult<unknown, unknown>) => {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "Something went wrong.",
  });
};

const pluginVariables = (plugin: McpPluginEntry): ReadonlyArray<McpServerVariable> => {
  const { transport } = plugin.manifest.mcpServer;
  return transport.type === "stdio" ? transport.env : transport.headers;
};

/**
 * MCP-native plugins on the primary environment. Each one's server shows in
 * Settings → Tools as "From plugin"; its variables are set here, not there.
 */
export function McpPluginsSettingsSection() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) return null;
  return <McpPluginsSettings environmentId={environmentId} />;
}

function McpPluginsSettings(props: { readonly environmentId: EnvironmentId }) {
  const listAtom = mcpPluginEnvironment.list({ environmentId: props.environmentId, input: {} });
  const plugins = useEnvironmentQuery(listAtom).data ?? EMPTY_PLUGINS;
  const refresh = useAtomRefresh(listAtom);
  const install = useAtomCommand(mcpPluginEnvironment.install, { reportFailure: false });
  const uninstall = useAtomCommand(mcpPluginEnvironment.uninstall, { reportFailure: false });
  const setEnabled = useAtomCommand(mcpPluginEnvironment.setEnabled, { reportFailure: false });
  const [directory, setDirectory] = useState("");
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const run = async (title: string, action: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    setPending(true);
    const result = await action();
    setPending(false);
    if (result._tag !== "Success") {
      reportFailure(title, result);
      return false;
    }
    refresh();
    return true;
  };

  return (
    <SettingsSection title="MCP plugins">
      {plugins.map((plugin) => {
        const { manifest } = plugin;
        const panels = manifest.contributes.panels.length;
        return (
          <div key={manifest.id}>
            <SettingsRow
              title={
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{manifest.displayName}</span>
                  <Badge variant="outline" size="sm">
                    {manifest.version}
                  </Badge>
                </span>
              }
              description={
                manifest.description ??
                `Server "${manifest.mcpServer.name}" · ${panels} ${panels === 1 ? "panel" : "panels"}`
              }
              control={
                <>
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost-muted"
                          aria-label={`${manifest.displayName} options`}
                        />
                      }
                    >
                      <MoreHorizontalIcon className="size-4" />
                    </MenuTrigger>
                    <MenuPopup align="end">
                      {plugin.directory !== undefined && pluginVariables(plugin).length > 0 ? (
                        <MenuItem onClick={() => setConfiguring(manifest.id)}>Configure</MenuItem>
                      ) : null}
                      <MenuItem
                        variant="destructive"
                        onClick={() =>
                          void run(`Couldn't remove ${manifest.displayName}`, () =>
                            uninstall({
                              environmentId: props.environmentId,
                              input: { pluginId: manifest.id },
                            }),
                          )
                        }
                      >
                        Uninstall
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                  <Switch
                    aria-label={`${manifest.displayName} plugin`}
                    checked={plugin.enabled}
                    disabled={pending}
                    onCheckedChange={(enabled) =>
                      void run(`Couldn't update ${manifest.displayName}`, () =>
                        setEnabled({
                          environmentId: props.environmentId,
                          input: { pluginId: manifest.id, enabled },
                        }),
                      )
                    }
                  />
                </>
              }
            />
            {configuring === manifest.id && plugin.directory !== undefined ? (
              <PluginVariablesForm
                plugin={plugin}
                disabled={pending}
                onCancel={() => setConfiguring(null)}
                onSave={(variables) =>
                  void run(`Couldn't save ${manifest.displayName}`, () =>
                    install({
                      environmentId: props.environmentId,
                      input: { directory: plugin.directory ?? "", variables },
                    }),
                  ).then((saved) => saved && setConfiguring(null))
                }
              />
            ) : null}
          </div>
        );
      })}
      <SettingsRow
        title="Install from a folder"
        description="A folder on this environment's machine with a t3-plugin.json."
        control={
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = directory.trim();
              if (trimmed === "") return;
              void run("Couldn't install the plugin", () =>
                install({ environmentId: props.environmentId, input: { directory: trimmed } }),
              ).then((installed) => installed && setDirectory(""));
            }}
          >
            <Input
              size="sm"
              aria-label="Plugin folder"
              placeholder="/path/to/plugin"
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
            />
            <Button size="sm" type="submit" disabled={pending || directory.trim() === ""}>
              Install
            </Button>
          </form>
        }
      />
    </SettingsSection>
  );
}

function PluginVariablesForm(props: {
  readonly plugin: McpPluginEntry;
  readonly disabled: boolean;
  readonly onCancel: () => void;
  readonly onSave: (variables: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <form
      className="space-y-2 px-3 pb-3 sm:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave(
          Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "")),
        );
      }}
    >
      {pluginVariables(props.plugin).map((variable) => (
        <label key={variable.name} className="block space-y-1 text-sm">
          <span>{variable.title ?? variable.name}</span>
          {variable.description ? (
            <span className="block text-muted-foreground text-xs">{variable.description}</span>
          ) : null}
          <Input
            size="sm"
            type={variable.sensitive ? "password" : "text"}
            placeholder="Leave blank to keep the current value"
            value={values[variable.name] ?? ""}
            onChange={(event) =>
              setValues((current) => ({ ...current, [variable.name]: event.target.value }))
            }
          />
        </label>
      ))}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={props.disabled}>
          Save
        </Button>
      </div>
    </form>
  );
}
