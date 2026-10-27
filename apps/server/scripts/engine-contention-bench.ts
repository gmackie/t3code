/**
 * Contention gate: V2 commits on a file-backed WAL database, twice without the engine (the worse is
 * the noise band) and once with it writing as fast as EngineWriteBudget allows. Passes when
 * median-rep p95/p99 stay within max(noise + 10%, noise + 2 ms) with no SQLITE_BUSY. Run `node
 * apps/server/scripts/engine-contention-bench.ts [--commits 1000] [--reps 5]`.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { EngineEventId, EngineName, PrincipalId, TenantId } from "@t3tools/engine/contracts";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as NodePerfHooks from "node:perf_hooks";

import * as EngineEffectLane from "../src/engine/EngineEffectLane.ts";
import * as EngineJournal from "../src/engine/EngineJournal.ts";
import * as EngineWriteBudget from "../src/engine/EngineWriteBudget.ts";
import * as EventSink from "../src/orchestration-v2/EventSink.ts";
import * as EventStore from "../src/orchestration-v2/EventStore.ts";
import * as ProjectionStore from "../src/orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../src/persistence/Sqlite.ts";

const argNumber = (flag: string, fallback: number) => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? Number(process.argv[index + 1]) : fallback;
};
const COMMITS = argNumber("--commits", 1_000);
const REPS = argNumber("--reps", 5);
const ENGINE_EFFECTS_PER_COMMIT = 9;
const ENGINE_EVENTS_PER_COMMIT =
  EngineJournal.MAX_ENGINE_COMMIT_ROWS - ENGINE_EFFECTS_PER_COMMIT - 1;
const MAX_RATIO = 1.1;
const SLACK_MS = 2;
/** How far `loaded` is above its allowance; at most 0 is within bounds. */
const excess = (loaded: number, band: number) =>
  loaded - Math.max(band * MAX_RATIO, band + SLACK_MS);

const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = Schema.decodeSync(ModelSelection)({ instanceId: "codex", model: "gpt-5.4" });
const decodeEventId = Schema.decodeSync(EngineEventId);
const benchStep = Schema.decodeSync(EngineName)("bench.step");
const tenant = Schema.decodeSync(TenantId)("bench");
const actor = {
  tenantId: tenant,
  principalId: Schema.decodeSync(PrincipalId)("owner"),
  kind: "human" as const,
};

const percentile = (samples: ReadonlyArray<number>, p: number) => {
  const sorted = samples.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};
const median = (values: ReadonlyArray<number>) => percentile(values, 50);
const isBusy = (cause: unknown) => String(cause).includes("SQLITE_BUSY");
const encodeReport = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

interface PhaseResult {
  readonly p95: number;
  readonly p99: number;
  readonly busy: number;
}
interface RepResult {
  readonly band: { readonly p95: number; readonly p99: number };
  readonly loaded: PhaseResult;
  readonly engine: { readonly commits: number; readonly busy: number };
  readonly ratio: { readonly p95: number; readonly p99: number };
  readonly excessMs: { readonly p95: number; readonly p99: number };
  readonly busy: number;
}

function makeThread(threadId: ThreadId, now: DateTime.Utc): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make(`project:${threadId}`),
    title: `Bench ${threadId}`,
    providerInstanceId,
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

/** COMMITS thread-creating V2 commands; returns commit p95/p99 and SQLITE_BUSY count. */
const v2Phase = Effect.fn("EngineContentionBench.v2Phase")(function* (label: string) {
  const eventSink = yield* EventSink.EventSinkV2;
  const samples: Array<number> = [];
  let busy = 0;
  for (let index = 0; index < COMMITS; index += 1) {
    const now = yield* DateTime.now;
    const threadId = ThreadId.make(`thread:${label}:${index}`);
    const event: OrchestrationV2DomainEvent = {
      id: EventId.make(`event:${label}:${index}`),
      type: "thread.created",
      threadId,
      providerInstanceId,
      occurredAt: now,
      payload: makeThread(threadId, now),
    };
    const start = NodePerfHooks.performance.now();
    yield* eventSink
      .commitCommand({
        commandId: CommandId.make(`command:${label}:${index}`),
        threadId,
        commandType: "bench.thread-create",
        acceptedAt: now,
        events: [event],
        effects: [],
      })
      .pipe(Effect.catchCauseIf(isBusy, () => Effect.sync(() => (busy += 1))));
    samples.push(NodePerfHooks.performance.now() - start);
    yield* Effect.yieldNow;
  }
  return { p95: percentile(samples, 95), p99: percentile(samples, 99), busy };
});

/** Engine writers at full demand; EngineWriteBudget decides how often they run. */
const engineLoad = Effect.fn("EngineContentionBench.engineLoad")(function* (
  label: string,
  stats: Ref.Ref<{ readonly commits: number; readonly busy: number }>,
) {
  const journal = yield* EngineJournal.EngineJournal;
  const registry: EngineEffectLane.EngineEffectRegistry<never, never> = {
    "bench.effect": { retryClass: "replay-safe", run: () => Effect.void },
  };
  for (let index = 0; ; index += 1) {
    const streamId = `${label}-run-${index}`;
    yield* journal
      .commit({
        tenantId: tenant,
        streamId,
        expectedVersion: 0,
        idempotencyKey: `${label}-${index}`,
        commandType: "bench.run",
        events: Array.from({ length: ENGINE_EVENTS_PER_COMMIT }, (_, n) => ({
          eventId: decodeEventId(`${label}-${index}-${n}`),
          type: benchStep,
          actor,
          occurredAt: "2026-10-21T00:00:00.000Z",
          payload: { n },
        })),
        effects: Array.from({ length: ENGINE_EFFECTS_PER_COMMIT }, (_, n) => ({
          effectId: `${label}-effect-${index}-${n}`,
          laneKey: `${streamId}-${n}`,
          type: "bench.effect",
          retryClass: "replay-safe" as const,
          payload: { n },
        })),
      })
      .pipe(
        Effect.tap(() => Ref.update(stats, (s) => ({ ...s, commits: s.commits + 1 }))),
        Effect.catchCauseIf(isBusy, () => Ref.update(stats, (s) => ({ ...s, busy: s.busy + 1 }))),
      );
    for (let n = 0; n < ENGINE_EFFECTS_PER_COMMIT; n += 1) {
      yield* EngineEffectLane.processNextEngineEffect(registry, {
        workerId: "bench-engine",
        leaseDuration: "30 seconds",
        maxAttempts: 3,
        retryDelay: () => "1 second" as const,
      });
    }
  }
});

const bench = Effect.gen(function* () {
  const reps: Array<RepResult> = [];
  for (let rep = 0; rep < REPS; rep += 1) {
    const quietA = yield* v2Phase(`quiet-a-${rep}`);
    const quietB = yield* v2Phase(`quiet-b-${rep}`);
    const stats = yield* Ref.make({ commits: 0, busy: 0 });
    const load = yield* engineLoad(`engine-${rep}`, stats).pipe(Effect.forkChild);
    const loaded = yield* v2Phase(`loaded-${rep}`);
    yield* Fiber.interrupt(load);
    const engine = yield* Ref.get(stats);
    const band = { p95: Math.max(quietA.p95, quietB.p95), p99: Math.max(quietA.p99, quietB.p99) };
    reps.push({
      band,
      loaded,
      engine,
      ratio: { p95: loaded.p95 / band.p95, p99: loaded.p99 / band.p99 },
      excessMs: { p95: excess(loaded.p95, band.p95), p99: excess(loaded.p99, band.p99) },
      busy: quietA.busy + quietB.busy + loaded.busy + engine.busy,
    });
  }
  const medianRatio = {
    p95: median(reps.map((rep) => rep.ratio.p95)),
    p99: median(reps.map((rep) => rep.ratio.p99)),
  };
  const medianExcessMs = {
    p95: median(reps.map((rep) => rep.excessMs.p95)),
    p99: median(reps.map((rep) => rep.excessMs.p99)),
  };
  const busy = reps.reduce((total, rep) => total + rep.busy, 0);
  const pass = medianExcessMs.p95 <= 0 && medianExcessMs.p99 <= 0 && busy === 0;
  yield* Console.log(
    yield* encodeReport({ commits: COMMITS, reps, medianRatio, medianExcessMs, busy, pass }),
  );
  if (!pass) process.exitCode = 1;
});

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "engine-contention-" });
  const databaseLayer = SqlitePersistence.layerFromPath(path.join(dir, "state.sqlite"));
  const storesLayer = Layer.mergeAll(EventStore.layer, ProjectionStore.layer).pipe(
    Layer.provideMerge(databaseLayer),
  );
  const engineLayer = Layer.mergeAll(EngineJournal.layer, EngineEffectLane.layer).pipe(
    Layer.provide(EngineWriteBudget.layer),
  );
  yield* bench.pipe(
    Effect.provide(
      Layer.mergeAll(EventSink.layer.pipe(Layer.provide(storesLayer)), engineLayer).pipe(
        Layer.provideMerge(storesLayer),
      ),
    ),
  );
});

program.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
