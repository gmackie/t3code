import {
  CommandId,
  EventId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { expect, it } from "@effect/vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

it.layer(NodeServices.layer)("thread.import decider", (it) => {
  it.effect("expands a normalized snapshot into existing presentation events", () =>
    Effect.gen(function* () {
      const at = "2026-01-01T00:00:00.000Z";
      const readModel = yield* projectEvent(createEmptyReadModel(at), {
        sequence: 1,
        eventId: EventId.make("event-project"),
        aggregateKind: "project",
        aggregateId: ProjectId.make("project-1"),
        type: "project.created",
        occurredAt: at,
        commandId: CommandId.make("create-project"),
        causationEventId: null,
        correlationId: CommandId.make("create-project"),
        metadata: {},
        payload: {
          projectId: ProjectId.make("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: at,
          updatedAt: at,
        },
      });
      const command: OrchestrationCommand = {
        type: "thread.import",
        commandId: CommandId.make("import-thread"),
        threadId: ThreadId.make("thread-imported"),
        projectId: ProjectId.make("project-1"),
        environmentId: EnvironmentId.make("local"),
        title: "Imported",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        originalCwd: "/tmp/project",
        normalizedHistory: [
          { _tag: "Message", sequence: 1, messageId: "native-user", role: "user", text: "hello" },
          { _tag: "Reasoning", sequence: 2, text: "thinking" },
          { _tag: "ToolCall", sequence: 3, callId: "call-1", name: "shell", input: { cmd: "pwd" } },
          {
            _tag: "ToolResult",
            sequence: 4,
            callId: "call-1",
            output: "/tmp/project",
            isError: false,
          },
          { _tag: "Message", sequence: 5, role: "assistant", text: "done" },
        ],
        provenance: {
          provider: {
            instanceId: ProviderInstanceId.make("codex"),
            driver: ProviderDriverKind.make("codex"),
          },
          nativeThreadId: "native-1",
          continuationGroup: "codex-home:/tmp/codex",
          originalCwd: "/tmp/project",
          resumeCursor: { threadId: "native-1" },
          decoderVersion: "codex-v1",
          importedAt: at,
        },
        createdAt: at,
        updatedAt: at,
      };

      const decided = yield* decideOrchestrationCommand({ command, readModel });
      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual([
        "thread.created",
        "thread.session-set",
        "thread.imported",
      ]);
      expect(events.at(-1)?.payload).toMatchObject({
        threadId: "thread-imported",
        provenance: { nativeThreadId: "native-1", decoderVersion: "codex-v1" },
      });
    }),
  );
});
