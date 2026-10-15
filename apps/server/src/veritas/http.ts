import * as Layer from "effect/Layer";
import { kicadVeritasRouteLayer } from "../kicad/veritasRoutes.ts";
import { reverseWorkbenchRouteLayer } from "../reverse/http.ts";

/** Preserve CAD endpoints while adding the authenticated, environment-owned firmware workbench. */
export const veritasIntegrationRouteLayer = Layer.mergeAll(
  kicadVeritasRouteLayer,
  reverseWorkbenchRouteLayer,
);
