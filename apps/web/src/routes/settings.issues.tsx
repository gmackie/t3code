import { createFileRoute } from "@tanstack/react-router";

import { IssueSettingsPanel } from "../components/settings/IssueSettings";

export const Route = createFileRoute("/settings/issues")({
  component: IssueSettingsPanel,
});
