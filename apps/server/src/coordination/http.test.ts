import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentHttpApi,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import { BobCoordinationError } from "@t3tools/contracts/bobCoordination";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as Etag from "effect/http/Etag";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as Admission from "./ExecutionAdmission.ts";
import * as ExecutionHttp from "./http.ts";

class ExecutionTestApi extends HttpApi.make("environment").add(
  EnvironmentHttpApi.groups.execution,
) {}

it.effect(
  "rejects invalid JSON and insufficient scopes and preserves authenticated admission ownership",
  () => {
    const scopes = new Set<AuthEnvironmentScope>(["orchestration:read"]);
    const calls: Array<{ owner: string; key: string | undefined }> = [];
    let fail = false;
    const routes = HttpApiBuilder.layer(ExecutionTestApi).pipe(
      Layer.provide(ExecutionHttp.layer),
      Layer.provide(
        Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
          effect.pipe(
            Effect.provideService(EnvironmentAuthenticatedPrincipal, {
              sessionId: AuthSessionId.make("session"),
              subject: "trusted-bob",
              method: "bearer-access-token",
              scopes,
            }),
          ),
        ),
      ),
      Layer.provide(
        Layer.succeed(Admission.ExecutionAdmission, {
          capabilities: Effect.succeed({
            contractVersion: "1",
            operations: [],
            executionProfiles: [],
            validationProfiles: [],
            eventResume: false,
            durableExecutionAdmission: true,
          }),
          submit: (owner, _input, key) =>
            Effect.suspend(() => {
              calls.push({ owner, key });
              return fail
                ? Effect.fail(
                    new BobCoordinationError({
                      code: "ExecutionUnknown",
                      status: 503,
                      message: "Pending launch.",
                    }),
                  )
                : Effect.succeed({
                    contractVersion: "1",
                    requestId: "request",
                    attemptId: "attempt",
                    executionId: "execution",
                    target: {
                      environmentId: "mini",
                      projectId: "project",
                      repository: { integrationId: "forgegraph", repositoryId: "repo" },
                    },
                    thread: { environmentId: "mini", projectId: "project", threadId: "thread" },
                  });
            }),
          find: () => Effect.die("Unused lookup"),
        }),
      ),
      Layer.provide(
        HttpPlatform.layer.pipe(
          Layer.provideMerge(NodeServices.layer),
          Layer.provideMerge(Etag.layerWeak),
        ),
      ),
      Layer.provide(NodeServices.layer),
    );
    return Effect.acquireUseRelease(
      Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
      (web) =>
        Effect.tryPromise(async () => {
          const post = (path: string, body: string) =>
            web.handler(
              new Request(`http://localhost${path}`, {
                method: "POST",
                headers: { "content-type": "application/json", "idempotency-key": "request" },
                body,
              }),
            );
          expect((await post("/api/v1/execution/requests", "{}")).status).toBe(403);
          expect(calls).toEqual([]);
          scopes.add("orchestration:operate");
          expect((await post("/api/v1/execution/requests", "{")).status).toBe(400);
          expect(
            (await post("/api/v1/coordination/capabilities/query", '{"contractVersion":"wrong"}'))
              .status,
          ).toBe(400);
          expect(calls).toEqual([]);
          const success = await post("/api/v1/execution/requests", "{}");
          expect(success.status).toBe(200);
          expect(success.headers.get("cache-control")).toBe("no-store");
          expect(calls).toEqual([{ owner: "trusted-bob", key: "request" }]);
          fail = true;
          const uncertain = await post("/api/v1/execution/requests", "{}");
          expect(uncertain.status).toBe(503);
          expect(await uncertain.json()).toMatchObject({
            code: "ExecutionUnknown",
            retryable: true,
          });
        }),
      (web) => Effect.promise(() => web.dispose()),
    );
  },
);
