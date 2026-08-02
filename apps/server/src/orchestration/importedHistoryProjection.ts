import {
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type { NormalizedThreadImportHistory } from "../threadImport/ThreadImportSource.ts";

export function projectImportedHistory(input: {
  threadId: ThreadId;
  createdAt: string;
  history: NormalizedThreadImportHistory;
}) {
  const messages: OrchestrationMessage[] = [];
  const activities: OrchestrationThreadActivity[] = [];
  let activeTurnId: TurnId | null = null;
  for (const item of input.history) {
    const createdAt = DateTime.formatIso(
      DateTime.add(DateTime.makeUnsafe(input.createdAt), { milliseconds: item.sequence }),
    );
    if (item._tag === "TurnLifecycle") {
      activeTurnId =
        item.phase === "started"
          ? TurnId.make(`import:${input.threadId}:turn:${item.turnId}`)
          : null;
    }
    if (item._tag === "Message") {
      messages.push({
        id: MessageId.make(`import:${input.threadId}:message:${item.sequence}`),
        role: item.role,
        text: item.text,
        attachments: [],
        turnId: activeTurnId,
        streaming: false,
        createdAt,
        updatedAt: createdAt,
      });
      continue;
    }
    const presentation = (() => {
      switch (item._tag) {
        case "TurnLifecycle":
          return {
            tone: item.phase === "failed" ? "error" : "info",
            kind: `turn.${item.phase}`,
            summary: `Turn ${item.phase}`,
          } as const;
        case "Reasoning":
          return { tone: "info", kind: "reasoning", summary: item.text } as const;
        case "ToolCall":
          return { tone: "tool", kind: "tool.call", summary: item.name } as const;
        case "ToolResult":
          return {
            tone: item.isError ? "error" : "tool",
            kind: "tool.result",
            summary: item.isError ? "Tool failed" : "Tool completed",
          } as const;
        case "Approval":
          return { tone: "approval", kind: "approval.imported", summary: item.prompt } as const;
        case "UserInput":
          return { tone: "approval", kind: "user-input.imported", summary: item.prompt } as const;
        case "Error":
          return { tone: "error", kind: "provider.error", summary: item.message } as const;
        case "Activity":
          return { tone: "info", kind: "provider.activity", summary: item.label } as const;
      }
    })();
    activities.push({
      id: EventId.make(`import:${input.threadId}:activity:${item.sequence}`),
      tone: presentation.tone,
      kind: presentation.kind,
      summary: presentation.summary,
      payload: item,
      turnId: activeTurnId,
      sequence: item.sequence,
      createdAt,
    });
  }
  return { messages, activities } as const;
}
