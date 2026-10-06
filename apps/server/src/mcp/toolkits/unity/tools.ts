import * as GameSessions from "../../../game/GameSessions.ts";
import {
  GameRequest,
  UnityCommandRequest,
  UnityCommandResult,
  OrchestratorMcpFailure,
  UnityHookRequest,
  UnityHookResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as UnityHooks from "../../../game/UnityHooks.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export const UnityToolkit = Toolkit.make(
  Tool.make("unity_command", {
    description:
      "Discover Unity commands and named gameplay actions, submit detached command jobs, inspect status, or request cancellation. Always specify an Editor project or development Player port file. Start with catalog; command parameters follow the returned schema (JSON parameters are strings). Submit returns acceptance, not completion; use status and inspect the engine result before reporting success. Cancellation is a request and may not stop engine work. Jobs are owned by Unity and survive T3 reconnects; retain the job ID and target. Requires full access.",
    parameters: Schema.Struct({ request: UnityCommandRequest }),
    success: UnityCommandResult,
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
  Tool.make("unity_game", {
    description:
      "Open an Editor or development Player game session, acquire expiring agent input control, send normalized pointer and held keys, monitor/write exposed hooks, release/close, or publish an inline HTML observation report. Requires the Pipeline game package. Start with open and target. Session IDs and leases belong to this thread. Input expires after durationMs (at most 1000); control expires after 1500ms without input. Humans can take over; never retry after control_lost without asking the user. For report, render the returned htmlRender reference using the inline HTML reply convention.",
    parameters: Schema.Struct({ request: GameRequest }),
    success: Schema.Unknown,
    failure: OrchestratorMcpFailure,
    dependencies: [
      GameSessions.GameSessions,
      McpInvocationContext.McpInvocationContext,
      ThreadManagement.ThreadManagementService,
    ],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, false),
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

export const UnitySnapshotTool = Tool.make("unity_game_snapshot", {
  description:
    "See the latest JPEG game frame from a unity_game session opened by this thread. Starts package capture on demand; no control lease is needed. Requires a running, rendered Game view.",
  parameters: Schema.Struct({ sessionId: Schema.String }),
  success: Schema.Struct({
    screenshot: Schema.Struct({
      mimeType: Schema.Literal("image/jpeg"),
      data: Schema.String,
      width: Schema.Int,
      height: Schema.Int,
    }),
  }),
  failure: OrchestratorMcpFailure,
  dependencies: [
    GameSessions.GameSessions,
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);
export const UnitySnapshotToolkit = Toolkit.make(UnitySnapshotTool);
