import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { Input } from "../ui/input";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

interface ProviderSettingsTarget {
  readonly environmentId?: EnvironmentId;
  readonly instanceId?: ProviderInstanceId;
  readonly scoped?: boolean;
  readonly environmentIds?: readonly EnvironmentId[];
}

export function ProviderSettingsPanel(target: ProviderSettingsTarget) {
  const primaryId = usePrimaryEnvironmentId();
  const environmentId = target.environmentId ?? primaryId;
  return (
    <SettingsPageContainer width="wide">
      {environmentId ? (
        <EnvironmentProviderSettings
          environmentId={environmentId}
          environmentLabel="Local computer"
        />
      ) : (
        <p>Waiting for the local server.</p>
      )}
    </SettingsPageContainer>
  );
}

export function EnvironmentProviderSettings({
  environmentId,
  readOnly = false,
  deviceTabs,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly readOnly?: boolean;
  readonly deviceTabs?: ReactNode;
  readonly targetInstanceId?: ProviderInstanceId | undefined;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  return (
    <SettingsSection title="OpenCode">
      <p>
        OpenCode runs on this computer. Configure your approved Cloudflare model, MCP servers, and
        plugins in OpenCode’s configuration.
      </p>
      {deviceTabs}
      <SettingsRow
        title="OpenCode executable"
        description="Install your approved OpenCode version before starting a thread."
        control={
          <Input
            aria-label="OpenCode executable"
            disabled={readOnly}
            value={settings.providers.opencode.binaryPath}
            onChange={(event) =>
              updateSettings({ providers: { opencode: { binaryPath: event.target.value } } })
            }
          />
        }
      />
    </SettingsSection>
  );
}
