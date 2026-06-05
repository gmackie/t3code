import { ClipboardListIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { LinearIssueValidationResult } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { readLocalApi } from "../../localApi";
import { Button } from "../ui/button";
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
  const [validation, setValidation] = useState<LinearIssueValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
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
  const validateLinear = useCallback(() => {
    const api = readLocalApi();
    if (!api) {
      setValidation({
        ok: false,
        workspaceName: null,
        userName: null,
        projects: [],
        error: "Local backend is unavailable.",
      });
      return;
    }

    setValidating(true);
    void api.server
      .validateLinearIssues()
      .then(setValidation)
      .catch((error) => {
        setValidation({
          ok: false,
          workspaceName: null,
          userName: null,
          projects: [],
          error: error instanceof Error ? error.message : "Unable to validate Linear settings.",
        });
      })
      .finally(() => setValidating(false));
  }, []);

  useEffect(() => {
    if (!linearSettings.enabled || linearSettings.apiToken.trim().length === 0) {
      setValidation(null);
      return;
    }

    const timeout = window.setTimeout(validateLinear, 400);
    return () => window.clearTimeout(timeout);
  }, [linearSettings.apiToken, linearSettings.domain, linearSettings.enabled, validateLinear]);

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Issue Providers"
        icon={<ClipboardListIcon className="size-3.5" aria-hidden />}
      >
        <SettingsRow
          title="Linear"
          description="Use Linear issues as the issue source for mapped projects."
          status={
            validation
              ? validation.ok
                ? `Connected${validation.workspaceName ? ` to ${validation.workspaceName}` : ""}`
                : "Validation failed"
              : linearSettings.enabled
                ? "Enabled"
                : "Disabled"
          }
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
          control={
            <Button size="sm" variant="outline" onClick={validateLinear} disabled={validating}>
              <RefreshCwIcon
                className={validating ? "size-3.5 animate-spin" : "size-3.5"}
                aria-hidden
              />
              Validate
            </Button>
          }
        />
        {validation ? (
          <div className="border-border border-t px-5 py-4">
            {validation.ok ? (
              <div className="space-y-2">
                <div className="text-muted-foreground text-xs">
                  {validation.projects.length} Linear{" "}
                  {validation.projects.length === 1 ? "project" : "projects"}
                  {validation.userName ? ` visible to ${validation.userName}` : ""}
                </div>
                <div className="max-h-64 overflow-auto rounded-md border border-border">
                  {validation.projects.length === 0 ? (
                    <div className="px-3 py-2 text-muted-foreground text-xs">
                      No Linear projects found.
                    </div>
                  ) : (
                    validation.projects.map((project) => (
                      <div
                        key={project.id}
                        className="flex items-center justify-between gap-3 border-border border-b px-3 py-2 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-sm">{project.name}</div>
                          <div className="truncate text-muted-foreground text-xs">
                            {project.teamKey ? project.teamKey : "No team"}
                            {project.teamName ? ` · ${project.teamName}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-muted-foreground text-xs">
                          {project.mappedProjectIds.length > 0
                            ? `${project.mappedProjectIds.length} mapped`
                            : "Unmapped"}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="text-destructive text-xs">
                {validation.error ?? "Unable to validate Linear settings."}
              </div>
            )}
          </div>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
