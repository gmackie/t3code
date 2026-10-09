import { MetaMaskError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as ServerBrowser from "../../../preview/ServerBrowser.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { MetaMaskToolkit } from "./tools.ts";

const invoke = Effect.fn("MetaMaskToolkit.invoke")(function* <A>(
  action: (
    browser: ServerBrowser.ServerBrowser["Service"],
    threadId: string,
  ) => Effect.Effect<A, MetaMaskError>,
) {
  const scope = yield* McpInvocationContext.requireThreadMcpCapability("preview").pipe(
    Effect.mapError(
      () =>
        new MetaMaskError({
          code: "permission_denied",
          detail: "Wallet tools require browser access and a T3 thread credential.",
        }),
    ),
  );
  return yield* action(yield* ServerBrowser.ServerBrowser, scope.thread.threadId);
});
export const layer = MetaMaskToolkit.toLayer({
  metamask_open: (input) =>
    invoke((browser, threadId) => browser.metamaskOpen(threadId, input.url)),
  metamask_pending: () => invoke((browser, threadId) => browser.metamaskPending(threadId)),
  metamask_request: (input) =>
    invoke((browser, threadId) => browser.metamaskRequest(threadId, input)),
  metamask_request_status: (input) =>
    invoke((browser, threadId) => browser.metamaskResult(threadId, input.clientRequestId)),
  metamask_approve: (input) =>
    invoke((browser, threadId) =>
      browser.metamaskApprove(threadId, input.approvalId, input.fingerprint),
    ),
  metamask_close: () => invoke((browser, threadId) => browser.metamaskClose(threadId)),
});
