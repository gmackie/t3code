import { createFileRoute } from "@tanstack/react-router";

import { ProjectsPage } from "../components/projects/ProjectsPage";

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
});
