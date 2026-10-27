import { linkOriginIsFenced, type ProjectId, type SystemsCapability } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { runtimeModeRank } from "../../delegatedTaskModes.ts";
import { callerLinkOrigin } from "../../linkOrigin.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { isLiveCallerShell, loadCaller } from "../../threadAccess.ts";

/**
 * The RFC-001 §13.3 capabilities an MCP caller holds, read from how T3 already scopes it:
 * everyone reads; whoever `McpToolAccess.writes` admits simulates; editing follows the
 * caller's modes. `projectId` omitted means the calling thread's own project.
 */
export const systemsAuthority = Effect.fn("mcp.systemsAuthority")(function* (
  projectId: ProjectId | undefined,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const granted = new Set<SystemsCapability>(["model.read"]);
  if (scope.client?.access === "read-only" || !scope.capabilities.has("orchestration"))
    return granted;
  const caller = yield* loadCaller();
  if (
    caller.caller !== undefined &&
    !isLiveCallerShell(caller.caller, scope.thread?.providerInstanceId)
  )
    return granted;
  granted.add("simulation.execute");
  // A fenced link may add work here but not change the user's files.
  const link = callerLinkOrigin(caller);
  if (link !== undefined && linkOriginIsFenced(link)) return granted;
  // Delegated children carry their own, never broader, modes; native subagents their parent's.
  const { runtimeMode, interactionMode } = caller.limits;
  const editsFiles =
    interactionMode === "default" &&
    runtimeModeRank(runtimeMode) >= runtimeModeRank("auto-accept-edits");
  const inScope =
    runtimeMode === "full-access" ||
    caller.caller === undefined ||
    projectId === undefined ||
    caller.caller.projectId === projectId;
  if (editsFiles && inScope) granted.add("model.edit");
  // No instrument or device adapter exists, so instrument.* and device.* are never granted.
  return granted;
});
