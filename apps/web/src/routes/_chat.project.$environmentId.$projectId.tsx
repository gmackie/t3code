import type { EnvironmentId } from "@t3tools/contracts";
import { ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { ProjectIssueViewer } from "../components/ProjectIssueViewer";

export const Route = createFileRoute("/_chat/project/$environmentId/$projectId")({
  component: ProjectIssueRoute,
});

function ProjectIssueRoute() {
  const { environmentId, projectId } = Route.useParams();

  return (
    <ProjectIssueViewer
      environmentId={environmentId as EnvironmentId}
      projectId={ProjectId.make(projectId)}
    />
  );
}
