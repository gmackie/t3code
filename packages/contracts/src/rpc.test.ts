import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { WS_METHODS, WsSubscribeServerConfigRpc } from "./rpc.ts";

describe("custom-local project import RPCs", () => {
  it("exposes external thread discovery", () => {
    expect(WS_METHODS).toHaveProperty("externalThreadsDiscover", "externalThreads.discover");
  });

  it("exposes project session scanning", () => {
    expect(WS_METHODS).toHaveProperty("projectSessionImportsScan", "projectSessionImports.scan");
  });

  it("exposes plugin lifecycle management", () => {
    expect(WS_METHODS).toHaveProperty("pluginList", "plugin.list");
  });

  it("exposes the project issue viewer", () => {
    expect(WS_METHODS).toHaveProperty("serverListProjectIssues", "server.listProjectIssues");
  });
});

/**
 * The client always sends `environmentThemes`, including to servers built
 * before the field existed, whose payload schema was an empty struct. What
 * makes that safe is that such a schema accepts the request rather than
 * rejecting it -- an error here would take down the config subscription.
 */
describe("subscribeServerConfig payload compatibility", () => {
  it("is accepted by a server whose schema predates the field", () => {
    const oldServerPayload = Schema.Struct({});
    const decoded = Schema.decodeUnknownExit(oldServerPayload)({ environmentThemes: true });
    expect(Exit.isSuccess(decoded)).toBe(true);
  });

  it("is carried by a server that declares it", () => {
    const decoded = Schema.decodeUnknownSync(WsSubscribeServerConfigRpc.payloadSchema)({
      environmentThemes: true,
    });
    expect(decoded).toEqual({ environmentThemes: true });
  });

  it("stays optional, so a client that never sends it still subscribes", () => {
    const decoded = Schema.decodeUnknownSync(WsSubscribeServerConfigRpc.payloadSchema)({});
    expect(decoded).toEqual({});
  });
});
