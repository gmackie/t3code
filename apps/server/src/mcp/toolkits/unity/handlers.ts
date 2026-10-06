import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as UnityHooks from "../../../game/UnityHooks.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { readFullAccessCaller } from "../../threadAccess.ts";
import { UnityToolkit } from "./tools.ts";

export const layer = UnityToolkit.toLayer({
  unity_hooks: ({ request }) =>
    Effect.gen(function* () {
      const { scope } = yield* readFullAccessCaller(
        "Unity hooks require a full-access agent in default mode.",
      );
      yield* McpInvocationContext.requireThreadScope(scope, "unity_hooks");
      const hooks = yield* UnityHooks.UnityHooks;
      return yield* hooks.execute(request).pipe(
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: `${error.code}: ${error.message}`,
            }),
        ),
      );
    }),
});
