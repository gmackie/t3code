import { RotateCcwIcon, SaveIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  defaultPluginSettings,
  type EnvironmentId,
  type PluginRegistryEntry,
  type PluginSettingContribution,
  type PluginSettingValue,
  type PluginSettingValueMap,
} from "@t3tools/contracts";
import { useAtomRefresh } from "@effect/atom-react";

import { pluginEnvironment } from "../../state/plugins";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { validatePluginSettingsDraft } from "./pluginSettingsForm.logic";

type Props = {
  environmentId: EnvironmentId;
  plugin: PluginRegistryEntry;
  projects: readonly Readonly<{ environmentId: EnvironmentId; id: string; title: string }>[];
  settingIds?: readonly string[];
  title?: string;
  description?: string;
  clientValues?: PluginSettingValueMap;
  onClientValuesChange?: (values: PluginSettingValueMap) => void;
};

export function PluginSettingsForm({
  environmentId,
  plugin,
  projects,
  settingIds,
  title = "Plugin settings",
  description,
  clientValues,
  onClientValuesChange,
}: Props) {
  const panelSettings = useMemo(
    () =>
      settingIds
        ? plugin.settings.filter((setting) => settingIds.includes(setting.id))
        : plugin.settings,
    [plugin.settings, settingIds],
  );
  const hasProjectSettings = panelSettings.some((setting) => setting.scope === "project");
  const hasClientSettings = panelSettings.some((setting) => setting.scope === "client");
  const projectOptions = useMemo(
    () => projects.filter((project) => project.environmentId === environmentId),
    [environmentId, projects],
  );
  const [scope, setScope] = useState<"client" | "server" | "project">(
    () => panelSettings.find((setting) => setting.scope === "client")?.scope ?? "server",
  );
  const [projectId, setProjectId] = useState<string | undefined>(projectOptions[0]?.id);
  const editableSettings = panelSettings.filter((setting) => setting.scope === scope);
  const target = {
    environmentId,
    input: {
      pluginId: plugin.pluginId,
      ...(scope === "project" && projectId !== undefined ? { projectId } : {}),
    },
  };
  const settingsAtom = pluginEnvironment.settingsGet(target);
  const settingsQuery = useEnvironmentQuery(settingsAtom);
  const refreshSettings = useAtomRefresh(settingsAtom);
  const updateSettings = useAtomCommand(pluginEnvironment.settingsUpdate, { reportFailure: false });
  const resetSettings = useAtomCommand(pluginEnvironment.settingsReset, { reportFailure: false });
  const [draft, setDraft] = useState<PluginSettingValueMap>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (scope === "client") {
      setDraft({ ...defaultPluginSettings(panelSettings), ...clientValues });
    } else if (settingsQuery.data) {
      setDraft({ ...defaultPluginSettings(panelSettings), ...settingsQuery.data.values });
    }
  }, [clientValues, panelSettings, scope, settingsQuery.data]);

  if (scope === "project" && projectId === undefined) {
    return (
      <SettingsSection title={title}>
        <SettingsRow
          title="Project settings"
          description="This plugin declares project-scoped settings, but no project is available in this environment."
        />
      </SettingsSection>
    );
  }

  const scopedDraft = Object.fromEntries(
    editableSettings.flatMap((setting) => {
      const value = draft[setting.id];
      return value === undefined ? [] : [[setting.id, value]];
    }),
  ) as PluginSettingValueMap;
  const validationError = validatePluginSettingsDraft(editableSettings, scopedDraft);
  const save = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    if (scope === "client") {
      onClientValuesChange?.(scopedDraft);
      setDraft((current) => ({ ...current, ...scopedDraft }));
      setSaving(false);
      return;
    }
    const result = await updateSettings({
      environmentId,
      input: {
        pluginId: plugin.pluginId,
        ...(scope === "project" && projectId !== undefined ? { projectId } : {}),
        values: scopedDraft,
      },
    });
    if (result._tag === "Success") {
      setDraft(result.value.values);
      refreshSettings();
    } else {
      setError("The plugin rejected these settings.");
    }
    setSaving(false);
  };
  const reset = async () => {
    setSaving(true);
    setError(null);
    if (scope === "client") {
      const defaults = defaultPluginSettings(panelSettings);
      onClientValuesChange?.(defaults);
      setDraft((current) => ({ ...current, ...defaults }));
      setSaving(false);
      return;
    }
    const result = await resetSettings({ environmentId, input: target.input });
    if (result._tag === "Success") {
      setDraft(result.value.values);
      refreshSettings();
    } else {
      setError("The plugin settings could not be reset.");
    }
    setSaving(false);
  };

  return (
    <SettingsSection
      title={title}
      headerAction={
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={saving}
            onClick={() => void reset()}
          >
            <RotateCcwIcon className="size-3.5" />
            Reset
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={saving || validationError !== null}
            onClick={() => void save()}
          >
            <SaveIcon className="size-3.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      {description ? <p className="px-4 text-xs text-muted-foreground">{description}</p> : null}
      {hasProjectSettings ? (
        <SettingsRow
          title="Settings scope"
          description="Server settings apply everywhere. Project settings are isolated to one workspace."
          control={
            <Select
              value={scope}
              onValueChange={(value) => {
                if (value !== null) setScope(value as "client" | "server" | "project");
              }}
            >
              <SelectTrigger size="sm" aria-label="Plugin settings scope">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {hasClientSettings ? <SelectItem value="client">This device</SelectItem> : null}
                <SelectItem
                  value="server"
                  disabled={!panelSettings.some((setting) => setting.scope === "server")}
                >
                  Server
                </SelectItem>
                <SelectItem value="project" disabled={projectOptions.length === 0}>
                  Project
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        >
          {scope === "project" ? (
            <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <span>Project</span>
              <Select
                value={projectId ?? ""}
                onValueChange={(value) => setProjectId(value ?? undefined)}
              >
                <SelectTrigger size="sm" aria-label="Plugin settings project">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectPopup>
                  {projectOptions.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
        </SettingsRow>
      ) : null}
      {settingsQuery.error ? (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {settingsQuery.error}
        </p>
      ) : null}
      {editableSettings.map((setting) => (
        <PluginSettingRow
          key={setting.id}
          setting={setting}
          value={draft[setting.id]}
          onChange={(value) => setDraft((current) => ({ ...current, [setting.id]: value }))}
        />
      ))}
      {error || validationError ? (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {error ?? validationError}
        </p>
      ) : null}
    </SettingsSection>
  );
}

function PluginSettingRow({
  setting,
  value,
  onChange,
}: {
  setting: PluginSettingContribution;
  value: PluginSettingValue | undefined;
  onChange: (value: PluginSettingValue) => void;
}) {
  const field = setting.field;
  let control: ReactNode;
  if (field.kind === "boolean") {
    control = (
      <Switch
        checked={value === true}
        onCheckedChange={(checked) => onChange(checked === true)}
        aria-label={setting.title}
      />
    );
  } else if (field.kind === "select") {
    control = (
      <Select
        value={typeof value === "string" ? value : ""}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <SelectTrigger size="sm" aria-label={setting.title}>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {field.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    );
  } else {
    control = (
      <Input
        nativeInput
        type={field.kind === "number" ? "number" : field.secret ? "password" : "text"}
        value={value === undefined ? "" : String(value)}
        placeholder={field.kind === "text" ? field.placeholder : undefined}
        min={field.kind === "number" ? field.min : undefined}
        max={field.kind === "number" ? field.max : undefined}
        step={field.kind === "number" ? field.step : undefined}
        aria-label={setting.title}
        onChange={(event) =>
          onChange(
            field.kind === "number" ? Number(event.currentTarget.value) : event.currentTarget.value,
          )
        }
      />
    );
  }
  return (
    <SettingsRow
      title={setting.title}
      description={
        setting.description ??
        (field.kind === "text" && field.secret ? "Stored securely by T3 Code." : "")
      }
      control={control}
    />
  );
}
