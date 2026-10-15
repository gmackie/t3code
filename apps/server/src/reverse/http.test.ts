// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  type Project,
} from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter } from "effect/http";
import { describe, expect, it } from "vite-plus/test";
import { EnvironmentAuth } from "../auth/EnvironmentAuth.ts";
import { ServerConfig } from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ReverseWorkbench from "./ReverseWorkbench.ts";
import { getReverseInvestigationStore } from "./InvestigationStore.ts";
import { reverseWorkbenchRouteLayer } from "./http.ts";

const url = "http://localhost/api/reverse/workbench";
const status = JSON.stringify({ projectId: "gone", investigationId: "i1", operation: "status" });

describe("Reverse workbench HTTP route", () => {
  it("refuses oversized bodies and deleted projects, and maps store errors", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-reverse-http-"));
    const routes = reverseWorkbenchRouteLayer.pipe(
      Layer.provideMerge(
        Layer.mock(EnvironmentAuth)({
          // Requests carrying x-test-operate act with operate scope.
          authenticateHttpRequest: (request) =>
            Effect.succeed({
              sessionId: AuthSessionId.make("test-session"),
              subject: "test",
              method: "bearer-access-token",
              scopes: request.headers["x-test-operate"]
                ? [AuthOrchestrationReadScope, AuthOrchestrationOperateScope]
                : [AuthOrchestrationReadScope],
            }),
        }),
      ),
      Layer.provide(
        ReverseWorkbench.layer.pipe(
          Layer.provide(
            Layer.mock(ProjectService.ProjectService)({
              // Only "live" exists; the cast stands in for a full project record.
              getById: (projectId) =>
                Effect.succeed(
                  projectId === "live"
                    ? Option.some({ workspaceRoot: root } as Project)
                    : Option.none(),
                ),
            }),
          ),
          Layer.provide(Layer.mock(ServerEnvironment.ServerEnvironment)({})),
          Layer.provide(ServerConfig.layerTest(root, NodePath.join(root, "state"))),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
        ),
      ),
      Layer.provideMerge(NodeHttpPlatform.layer),
      Layer.provideMerge(NodeServices.layer),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
    const headers = { "content-type": "application/json" };
    try {
      const declared = await handler(
        new Request(url, {
          method: "POST",
          headers: { ...headers, "content-length": "65537" },
          body: "x".repeat(65537),
        }),
      );
      expect(declared.status).toBe(413);

      const deleted = await handler(new Request(url, { method: "POST", headers, body: status }));
      expect(deleted.status).toBe(404);

      // Store errors keep their reason instead of collapsing into a generic 400.
      const missing = await handler(
        new Request(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ projectId: "live", investigationId: "i1", operation: "status" }),
        }),
      );
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ reason: "not_found" });

      // Workbench scans run the same analyzers as the RPCs.
      await NodeFSP.writeFile(NodePath.join(root, "fw.bin"), "\0\0boot=quiet\0");
      const stateDir = await Effect.runPromise(
        Effect.gen(function* () {
          return (yield* ServerConfig).stateDir;
        }).pipe(
          Effect.provide(
            ServerConfig.layerTest(root, NodePath.join(root, "state")).pipe(
              Layer.provide(NodeServices.layer),
            ),
          ),
        ),
      );
      const { investigation } = await getReverseInvestigationStore(stateDir).importFile({
        projectId: "live",
        environmentId: "env",
        workspaceRoot: root,
        relativePath: "fw.bin",
      });
      const scanned = await handler(
        new Request(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            projectId: "live",
            investigationId: investigation.id,
            operation: "scan",
            engine: "strings",
          }),
        }),
      );
      expect(scanned.status).toBe(403);
      const operated = await handler(
        new Request(url, {
          method: "POST",
          headers: { ...headers, "x-test-operate": "1" },
          body: JSON.stringify({
            projectId: "live",
            investigationId: investigation.id,
            operation: "scan",
            engine: "strings",
          }),
        }),
      );
      expect(operated.status).toBe(200);
      expect(await operated.json()).toMatchObject({
        operation: "scan",
        data: { strings: [{ offset: 2, value: "boot=quiet" }], truncated: false },
      });
    } finally {
      await dispose();
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
