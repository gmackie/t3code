import { OrchestratorMcpFailure, UnityHookRequest, UnityHookResult } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as UnityHooks from "../../../game/UnityHooks.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export const UnityToolkit = Toolkit.make(
  Tool.make("unity_hooks", {
    description:
      "Discover, read, write, assert or watch game-owned Unity variables. Requires the GMacko Pipeline agent-hook package, Editor Play Mode or a development Player, and Unity CLI on this environment. Start with action=list and an explicit absolute projectPath (Editor) or portFile (Player). Reuse the returned generation and handles. Watches sample in Unity without repeated CLI calls; use watch_read for bounded history and watch_stop with forget=true to release it. This tool does not launch Unity or control game input. A timed-out mutation may have applied: read before retrying.",
    parameters: Schema.Struct({ request: UnityHookRequest }),
    success: UnityHookResult,
    failure: OrchestratorMcpFailure,
    dependencies: [
      UnityHooks.UnityHooks,
      McpInvocationContext.McpInvocationContext,
      ThreadManagement.ThreadManagementService,
    ],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, false),
);
