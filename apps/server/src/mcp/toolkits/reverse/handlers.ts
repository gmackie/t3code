import { OrchestratorMcpFailure, type ReverseStoreError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ReverseWorkbench from "../../../reverse/ReverseWorkbench.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { ReverseToolkit } from "./tools.ts";

// Store messages are written for the person or agent who made the request.
const toFailure = (error: ReverseStoreError) =>
  new OrchestratorMcpFailure({
    code:
      error.reason === "unavailable" || error.reason === "operation_failed"
        ? "orchestration_error"
        : "invalid_request",
    message: error.message,
  });

const call =
  <I, A>(
    method: (
      workbench: ReverseWorkbench.ReverseWorkbench["Service"],
    ) => (input: I) => Effect.Effect<A, ReverseStoreError>,
  ) =>
  (input: I) =>
    ReverseWorkbench.ReverseWorkbench.pipe(
      Effect.flatMap((workbench) => method(workbench)(input)),
      Effect.mapError(toFailure),
    );

export const layer = McpToolAccess.toLayer(ReverseToolkit, {
  t3_reverse_toolchain: McpToolAccess.reads(call((workbench) => () => workbench.toolchain)),
  t3_reverse_list: McpToolAccess.reads(call((workbench) => workbench.list)),
  t3_reverse_strings: McpToolAccess.reads(call((workbench) => workbench.strings)),
  t3_reverse_import: McpToolAccess.writes(call((workbench) => workbench.importFile)),
  t3_reverse_link: McpToolAccess.writes(call((workbench) => workbench.link)),
  t3_reverse_analyze: McpToolAccess.writes(call((workbench) => workbench.analyze)),
  t3_reverse_emulate: McpToolAccess.writes(call((workbench) => workbench.emulate)),
});
