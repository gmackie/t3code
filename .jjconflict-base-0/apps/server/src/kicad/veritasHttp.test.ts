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
} from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it } from "vite-plus/test";
import { EnvironmentAuth } from "../auth/EnvironmentAuth.ts";
import { ServerConfig } from "../config.ts";
import { kicadViewerSessionRouteLayer } from "./http.ts";
import { kicadVeritasRouteLayer } from "./veritasHttp.ts";

describe("Veritas CAD HTTP authorization", () => {
  for (const canOperate of [false, true]) {
    it(`keeps the viewer's ${canOperate ? "operate" : "read-only"} access on Veritas actions`, async () => {
      const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-veritas-http-"));
      const routes = Layer.mergeAll(kicadViewerSessionRouteLayer, kicadVeritasRouteLayer).pipe(
        Layer.provideMerge(
          Layer.mock(EnvironmentAuth)({
            authenticateHttpRequest: () =>
              Effect.succeed({
                sessionId: AuthSessionId.make("test-session"),
                subject: "test",
                method: "bearer-access-token",
                scopes: canOperate
                  ? [AuthOrchestrationReadScope, AuthOrchestrationOperateScope]
                  : [AuthOrchestrationReadScope],
              }),
          }),
        ),
        Layer.provide(ServerConfig.layerTest(root, NodePath.join(root, "state"))),
        Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
        Layer.provideMerge(NodeHttpPlatform.layer),
        Layer.provideMerge(NodeServices.layer),
      );
      const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
      try {
        const minted = await handler(
          new Request(`http://localhost/api/kicad/viewer-session?cwd=${encodeURIComponent(root)}`, {
            method: "POST",
          }),
        );
        expect(minted.status, await minted.clone().text()).toBe(200);
        const session = (await minted.json()) as { token: string };
        const endpoint = `http://localhost/api/kicad/veritas?token=${session.token}`;
        const status = await handler(new Request(endpoint));
        expect(status.status).toBe(200);
        expect(await status.json()).toMatchObject({ configured: false, canOperate });
        const action = await handler(
          new Request(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "unlink" }),
          }),
        );
        expect(action.status).toBe(canOperate ? 200 : 403);
        const snapshot = await handler(
          new Request("http://localhost/api/kicad/veritas/snapshot/unknown"),
        );
        expect(snapshot.status).toBe(404);
      } finally {
        await dispose();
        await NodeFSP.rm(root, { recursive: true, force: true });
      }
    });
  }
});
