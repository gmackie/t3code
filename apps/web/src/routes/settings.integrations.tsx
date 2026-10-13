import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/settings/integrations")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/source-control", replace: true });
  },
});
