import { AuthOrchestrationReadScope, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as ExpoPush from "./ExpoPush.ts";

export const notificationsHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "notifications",
  Effect.fnUntraced(function* (handlers) {
    const push = yield* ExpoPush.ExpoPush;
    return handlers.handle("register", ({ payload }) =>
      Effect.gen(function* () {
        const session = yield* requireEnvironmentScope(AuthOrchestrationReadScope);
        return yield* push.register(session.sessionId, payload);
      }),
    );
  }),
);
