import { projectThreadAwarenessV2 } from "@t3tools/shared/agentAwareness";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import {
  shouldPublishAgentAwarenessEvent,
  makeAgentAwarenessPublishWorker,
} from "../relay/AgentAwarenessRelay.ts";
import { forkParked } from "../serverActivation.ts";
import * as ExpoPush from "./ExpoPush.ts";
import type { ThreadId } from "@t3tools/contracts";

export const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const push = yield* ExpoPush.ExpoPush;
  const startedAt = (yield* DateTime.now).epochMilliseconds;
  const worker = yield* makeAgentAwarenessPublishWorker(
    Effect.fnUntraced(
      function* (threadId: ThreadId) {
        if (!(yield* push.hasRegistrations)) return;
        const thread = yield* threads.getThreadShell(threadId);
        if (!thread || thread.archivedAt !== null || thread.deletedAt !== null) return;
        const project = yield* projects.getById(thread.projectId);
        if (Option.isNone(project)) return;
        const state = projectThreadAwarenessV2({
          environmentId: yield* environment.getEnvironmentId,
          project: project.value,
          thread,
        });
        if (!state) return;
        const terminal = state.phase === "completed" || state.phase === "failed";
        if (terminal && !thread.latestRunCompletedAt) return;
        const occurredAt = DateTime.toEpochMillis(
          terminal && thread.latestRunCompletedAt
            ? thread.latestRunCompletedAt
            : (thread.pendingRuntimeRequest?.createdAt ?? thread.updatedAt),
        );
        if (occurredAt < startedAt) return;
        const identity = `${thread.latestRunId}:${state.phase}:${thread.pendingRuntimeRequest?.id ?? ""}`;
        yield* push.publish(state, identity, occurredAt);
      },
      Effect.retry({ times: 3, schedule: Schedule.exponential("1 second") }),
      Effect.catch(() => Effect.logWarning("Could not publish Expo agent notification")),
    ),
  );
  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      shouldPublishAgentAwarenessEvent(event) ? worker.enqueue(event.threadId) : Effect.void,
    ),
  );
  yield* forkParked(
    Effect.forever(
      Effect.sleep("15 minutes").pipe(
        Effect.andThen(push.checkReceipts),
        Effect.catch(() => Effect.logWarning("Could not check Expo push receipts")),
      ),
    ),
  );
  return worker;
});

export const layer = Layer.effectDiscard(make);
