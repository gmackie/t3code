import { ClipboardListIcon } from "lucide-react";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

function LinearSettingsResetButton({
  label,
  field,
}: {
  readonly label: string;
  readonly field: "apiToken" | "domain" | "defaultTeamKey";
}) {
  const linearSettings = useSettings((settings) => settings.issues.linear);
  const { updateSettings } = useUpdateSettings();
  const defaultValue = DEFAULT_UNIFIED_SETTINGS.issues.linear[field];

  if (linearSettings[field] === defaultValue) {
    return null;
  }

  return (
    <SettingResetButton
      label={label}
      onClick={() =>
        updateSettings({
          issues: {
            linear: {
              ...linearSettings,
              [field]: defaultValue,
            },
          },
        })
      }
    />
  );
}

export function IssueSettingsPanel() {
  const linearSettings = useSettings((settings) => settings.issues.linear);
  const { updateSettings } = useUpdateSettings();
  const mappedProjectCount = Object.keys(linearSettings.projectMappings).length;
  const updateLinearSettings = (patch: Partial<typeof linearSettings>) => {
    updateSettings({
      issues: {
        linear: {
          ...linearSettings,
          ...patch,
        },
      },
    });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Issue Providers"
        icon={<ClipboardListIcon className="size-3.5" aria-hidden />}
      >
        <SettingsRow
          title="Linear"
          description="Use Linear issues as the issue source for mapped projects."
          status={linearSettings.enabled ? "Enabled" : "Disabled"}
          control={
            <Switch
              checked={linearSettings.enabled}
              aria-label="Enable Linear issue provider"
              onCheckedChange={(enabled) => updateLinearSettings({ enabled })}
            />
          }
        />
        <SettingsRow
          title="API token"
          description="Server-side Linear API token used to read and update Linear issues."
          resetAction={<LinearSettingsResetButton label="Linear API token" field="apiToken" />}
          control={
            <Input
              nativeInput
              type="password"
              value={linearSettings.apiToken}
              aria-label="Linear API token"
              className="w-full sm:w-72"
              placeholder="lin_api_..."
              onChange={(event) => updateLinearSettings({ apiToken: event.currentTarget.value })}
            />
          }
        />
        <SettingsRow
          title="Domain"
          description="Optional domain for Linear-compatible issue providers."
          resetAction={<LinearSettingsResetButton label="Linear domain" field="domain" />}
          control={
            <Input
              nativeInput
              value={linearSettings.domain}
              aria-label="Linear domain"
              className="w-full sm:w-72"
              placeholder="linear.app"
              onChange={(event) => updateLinearSettings({ domain: event.currentTarget.value })}
            />
          }
        />
        <SettingsRow
          title="Default team"
          description="Optional Linear team key used when a project mapping does not specify its own team."
          resetAction={
            <LinearSettingsResetButton label="Linear default team" field="defaultTeamKey" />
          }
          control={
            <Input
              nativeInput
              value={linearSettings.defaultTeamKey}
              aria-label="Linear default team"
              className="w-full sm:w-32"
              placeholder="ENG"
              onChange={(event) =>
                updateLinearSettings({ defaultTeamKey: event.currentTarget.value })
              }
            />
          }
        />
        <SettingsRow
          title="Project mappings"
          description="Associates T3 Code projects with Linear projects. Manage mappings from a project's context menu."
          status={`${mappedProjectCount} mapped ${
            mappedProjectCount === 1 ? "project" : "projects"
          }`}
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
