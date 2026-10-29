import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import { ThreadId } from "@t3tools/contracts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import {
  makeAgentAwarenessPublishWorker,
  shouldPublishAgentAwarenessEvent,
} from "../relay/AgentAwarenessRelay.ts";
import { forkParked } from "../serverActivation.ts";
import * as LiveActivities from "./LiveActivities.ts";

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const activities = yield* LiveActivities.LiveActivities;
  const publish = activities.publish.pipe(
    Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
    Effect.catch(() => Effect.logWarning("Could not publish Live Activity updates")),
  );
  const worker = yield* makeAgentAwarenessPublishWorker(() => publish);
  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      shouldPublishAgentAwarenessEvent(event)
        ? worker.enqueue(ThreadId.make("live-activities"))
        : Effect.void,
    ),
  );
  // Refresh the stale-date while quiet work runs; the phone does not need a JS background task.
  yield* forkParked(
    publish.pipe(
      Effect.andThen(Effect.forever(Effect.sleep("5 minutes").pipe(Effect.andThen(publish)))),
    ),
  );
});

export const layer = Layer.effectDiscard(make);
