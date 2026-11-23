import { McpPluginsSettingsSection } from "./McpPluginsSettings";
import { SettingsPageContainer } from "./settingsLayout";

export function PluginsSettingsPanel() {
  return (
    <SettingsPageContainer>
      <McpPluginsSettingsSection />
    </SettingsPageContainer>
  );
}
