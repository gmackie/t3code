import { createFileRoute } from "@tanstack/react-router";

import { RoutingPage } from "../components/routing/RoutingPage";

export const Route = createFileRoute("/routing")({
  component: RoutingPage,
});
