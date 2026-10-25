import { createFileRoute } from "@tanstack/react-router";

import { ChangelogSettingsPanel } from "../components/settings/ChangelogSettings";

export const Route = createFileRoute("/_chat/settings/changelog")({
  component: ChangelogSettingsPanel,
});
