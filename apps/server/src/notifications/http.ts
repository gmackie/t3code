import { AuthOrchestrationReadScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as ExpoPush from "./ExpoPush.ts";
import * as LiveActivities from "./LiveActivities.ts";

export const notificationsHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "notifications",
  Effect.fnUntraced(function* (handlers) {
    const push = yield* ExpoPush.ExpoPush;
    const activities = yield* LiveActivities.LiveActivities;
    return handlers
      .handle("register", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* push.register(session.sessionId, payload);
        }),
      )
      .handle("liveActivitySnapshot", () =>
        Effect.gen(function* () {
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* activities.snapshot;
        }),
      )
      .handle("registerLiveActivity", ({ payload }) =>
        Effect.gen(function* () {
          const session = yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* activities.register(session.sessionId, payload);
        }),
      );
  }),
);
