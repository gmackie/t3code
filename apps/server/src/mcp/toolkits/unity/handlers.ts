import * as GameSessions from "../../../game/GameSessions.ts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as UnityHooks from "../../../game/UnityHooks.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { readFullAccessCaller } from "../../threadAccess.ts";
import { UnityToolkit, UnitySnapshotToolkit } from "./tools.ts";

export const layer = UnityToolkit.toLayer({
  unity_game: ({ request }) =>
    Effect.gen(function* () {
      const { scope } = yield* readFullAccessCaller(
        "Unity gameplay requires a full-access agent in default mode.",
      );
      const thread = yield* McpInvocationContext.requireThreadScope(scope, "unity_game");
      const games = yield* GameSessions.GameSessions;
      return yield* games.agentRequest(thread.thread.threadId, request).pipe(
        Effect.map((result) => {
          if (
            request.action === "report" &&
            result !== null &&
            typeof result === "object" &&
            "htmlRender" in result
          )
            return { htmlRender: result.htmlRender };
          return result;
        }),
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({
              code: "orchestration_error",
              message: `${error.code}: ${error.message}`,
            }),
        ),
      );
    }),
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

export const layerSnapshot = UnitySnapshotToolkit.toLayer({
  unity_game_snapshot: ({ sessionId }) =>
    Effect.gen(function* () {
      const { scope } = yield* readFullAccessCaller(
        "Unity snapshots require an active full-access agent.",
      );
      const thread = yield* McpInvocationContext.requireThreadScope(scope, "unity_game_snapshot");
      const games = yield* GameSessions.GameSessions;
      return yield* games.agentSnapshot(thread.thread.threadId, sessionId).pipe(
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
