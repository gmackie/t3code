import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProjectId, type Project, type SystemsRun } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as SystemsService from "./SystemsService.ts";

const FIXTURES = new URL(
  "../../../../packages/systems-model/fixtures/conformance-v0.1/",
  import.meta.url,
);
const PUMP = "experiments/pump-nominal.run.json";
const LONG = "experiments/pump-long.run.json";
const projectA = ProjectId.make("project-a");
const projectB = ProjectId.make("project-b");

/** Two T3 projects; A holds the conformance pack under `sw/`, plus a pump run too long to finish. */
const workspace = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const base = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const rootA = path.join(base, "a");
  const rootB = path.join(base, "b");
  yield* fs.makeDirectory(rootB, { recursive: true });
  yield* fs.makeDirectory(rootA, { recursive: true });
  yield* fs.copy(yield* path.fromFileUrl(FIXTURES), path.join(rootA, "sw"));
  const pump = JSON.parse(yield* fs.readFileString(path.join(rootA, "sw", PUMP)));
  yield* fs.writeFileString(
    path.join(rootA, "sw", LONG),
    JSON.stringify({ ...pump, id: "run.pump.long", stop: { num: "100000", den: "1" } }),
  );
  return { fs, path, rootA, rootB };
});

const projects = (roots: Readonly<Record<string, string>>) =>
  Layer.mock(ProjectService.ProjectService)({
    getById: (id) =>
      Effect.succeed(
        Option.fromNullishOr(
          roots[id] === undefined ? undefined : ({ id, workspaceRoot: roots[id] } as Project),
        ),
      ),
  });

const service = (
  roots: Readonly<Record<string, string>>,
  options: SystemsService.SystemsServiceOptions = { chunkBoundaries: 4 },
) => SystemsService.make(options).pipe(Effect.provide(projects(roots)));

/** Resolves once the run has committed at least one chunk. */
const progressed = (systems: SystemsService.SystemsService["Service"], run: SystemsRun) =>
  systems.subscribeRuns({ projectId: run.projectId }).pipe(
    Stream.filter(({ runs }) =>
      runs.some((candidate) => candidate.runId === run.runId && candidate.eventCount > 0),
    ),
    Stream.runHead,
  );

const allEvents = (
  systems: SystemsService.SystemsService["Service"],
  run: SystemsRun,
  limit: number,
) =>
  Effect.gen(function* () {
    const pages = [];
    let fromSequence = "0";
    for (;;) {
      const page = yield* systems.runEvents({ ...ref(run), fromSequence, limit });
      pages.push(page);
      fromSequence = page.nextSequence;
      if (!page.hasMore) return pages;
    }
  });

const ref = (run: SystemsRun) => ({ projectId: run.projectId, runId: run.runId });

const layer = Layer.mergeAll(
  NodeServices.layer,
  SqlitePersistence.layerMemory.pipe(Layer.provide(NodeServices.layer)),
);

// Each test gets its own database, as each server start would.
describe("SystemsService", () => {
  {
    it.effect("runs the pump fixture to completion with reproducible metadata", () =>
      Effect.gen(function* () {
        const { rootA } = yield* workspace;
        const systems = yield* service({ [projectA]: rootA });
        const created = yield* systems.createRun({
          projectId: projectA,
          path: "sw",
          experimentRef: PUMP,
          idempotencyKey: "pump-1",
        });
        assert.strictEqual(created.status, "queued");
        const done = yield* systems.awaitRun(ref(created));
        assert.strictEqual(done.status, "completed");
        assert.match(done.semanticDigest, /^sha256:[0-9a-f]{64}$/);
        assert.match(done.runDigest, /^sha256:[0-9a-f]{64}$/);
        assert.notStrictEqual(done.runDigest, done.planDigest);
        assert.strictEqual(done.solver, "rk4-fixed@1");
        assert.strictEqual(done.seed, "0");
        assert.deepStrictEqual(done.lastCommittedTime, { num: "6", den: "1" });
        assert.isAbove(done.eventCount, 0);
        assert.isAbove(done.sampleCount, 0);
        assert.deepStrictEqual(
          done.probes.map((probe) => [probe.id, probe.unit]),
          [
            ["level", "m"],
            ["pump_enabled", "1"],
          ],
        );
        const comparison = yield* systems.compareRun(ref(done));
        assert.deepStrictEqual(comparison, {
          expectedRef: "expected/pump-nominal.trace.json",
          mismatches: [],
        });
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("create and cancel are idempotent", () =>
      Effect.gen(function* () {
        const { rootA } = yield* workspace;
        const systems = yield* service({ [projectA]: rootA });
        const input = {
          projectId: projectA,
          path: "sw",
          experimentRef: PUMP,
          idempotencyKey: "same-key",
        };
        const first = yield* systems.createRun(input);
        const again = yield* systems.createRun(input);
        assert.strictEqual(again.runId, first.runId);
        const done = yield* systems.awaitRun(ref(first));
        assert.strictEqual((yield* systems.createRun(input)).runId, first.runId);
        const other = yield* Effect.flip(
          systems.createRun({ ...input, experimentRef: "experiments/timer.run.json" }),
        );
        assert.strictEqual(other.reason, "invalid_model");

        const cancelled = yield* systems.cancelRun({ ...ref(first), idempotencyKey: "c-1" });
        assert.deepStrictEqual(cancelled, done);
        assert.deepStrictEqual(
          yield* systems.cancelRun({ ...ref(first), idempotencyKey: "c-1" }),
          done,
        );
        assert.strictEqual((yield* systems.listRuns({ projectId: projectA })).runs.length, 1);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("a queued run cancels at once and never starts", () =>
      Effect.gen(function* () {
        const { rootA } = yield* workspace;
        const systems = yield* service(
          { [projectA]: rootA },
          { chunkBoundaries: 4, maxConcurrentRuns: 1 },
        );
        const base = { projectId: projectA, path: "sw", experimentRef: LONG };
        const long = yield* systems.createRun({ ...base, idempotencyKey: "long" });
        const queued = yield* systems.createRun({ ...base, idempotencyKey: "queued" });
        const cancelled = yield* systems.cancelRun({ ...ref(queued), idempotencyKey: "c" });
        assert.strictEqual(cancelled.status, "cancelled");
        assert.strictEqual(cancelled.eventCount, 0);
        yield* systems.cancelRun({ ...ref(long), idempotencyKey: "c" });
        assert.strictEqual((yield* systems.awaitRun(ref(long))).status, "cancelled");
        assert.strictEqual((yield* systems.getRun(ref(queued))).startedAt, undefined);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("cancelling mid-run keeps the partial trace and finishes it", () =>
      Effect.gen(function* () {
        const { rootA } = yield* workspace;
        const systems = yield* service({ [projectA]: rootA });
        const run = yield* systems.createRun({
          projectId: projectA,
          path: "sw",
          experimentRef: LONG,
          idempotencyKey: "long-cancel",
        });
        yield* progressed(systems, run);
        yield* systems.cancelRun({ ...ref(run), idempotencyKey: "stop" });
        const done = yield* systems.awaitRun(ref(run));
        assert.strictEqual(done.status, "cancelled");
        assert.isBelow(done.boundaries, 1_000_000);
        const events = (yield* allEvents(systems, done, 500)).flatMap((page) => page.events);
        assert.strictEqual(events.length, done.eventCount);
        const last = events.at(-1);
        assert.strictEqual(last?.kind, "run.finish");
        assert.deepInclude(last?.payload as object, { status: "cancelled" });
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("event pages are loss-free and their cursors are stable", () =>
      Effect.gen(function* () {
        const { rootA } = yield* workspace;
        const systems = yield* service({ [projectA]: rootA });
        const run = yield* systems.createRun({
          projectId: projectA,
          path: "sw",
          experimentRef: PUMP,
          idempotencyKey: "pages",
        });
        const done = yield* systems.awaitRun(ref(run));
        const paged = (yield* allEvents(systems, done, 7)).flatMap((page) => page.events);
        const whole = (yield* allEvents(systems, done, 500)).flatMap((page) => page.events);
        assert.deepStrictEqual(paged, whole);
        assert.strictEqual(paged.length, done.eventCount);
        assert.deepStrictEqual(
          paged.map((event) => event.sequence),
          paged.map((_, index) => String(index)),
        );
        const end = yield* systems.runEvents({
          ...ref(done),
          fromSequence: String(paged.length),
          limit: 5,
        });
        assert.deepStrictEqual(end, {
          events: [],
          nextSequence: String(paged.length),
          hasMore: false,
        });
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("downsampled signals stay within maxPoints and keep the min/max envelope", () =>
      Effect.gen(function* () {
        const { rootA } = yield* workspace;
        const systems = yield* service({ [projectA]: rootA });
        const run = yield* systems.createRun({
          projectId: projectA,
          path: "sw",
          experimentRef: PUMP,
          idempotencyKey: "signals",
        });
        const done = yield* systems.awaitRun(ref(run));
        const [raw] = (yield* systems.runSignals({
          ...ref(done),
          signalIds: ["level"],
          maxPoints: 4000,
        })).series;
        const [envelope] = (yield* systems.runSignals({
          ...ref(done),
          signalIds: ["level"],
          maxPoints: 6,
        })).series;
        assert.strictEqual(raw?.resolution, "raw");
        assert.strictEqual(envelope?.resolution, "envelope");
        assert.isAbove(raw!.points.length, 6);
        assert.isAtMost(envelope!.points.length, 6);
        assert.strictEqual(envelope!.totalSamples, raw!.points.length);
        const values = (points: ReadonlyArray<{ readonly value: number | boolean }>) =>
          points.map((point) => Number(point.value));
        assert.strictEqual(Math.max(...values(envelope!.points)), Math.max(...values(raw!.points)));
        assert.strictEqual(Math.min(...values(envelope!.points)), Math.min(...values(raw!.points)));
        const seconds = envelope!.points.map((point) => point.seconds);
        assert.deepStrictEqual(
          seconds,
          seconds.toSorted((a, b) => a - b),
        );
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("another project's models and runs are out of reach", () =>
      Effect.gen(function* () {
        const { rootA, rootB } = yield* workspace;
        const systems = yield* service({ [projectA]: rootA, [projectB]: rootB });
        const run = yield* systems.createRun({
          projectId: projectA,
          path: "sw",
          experimentRef: PUMP,
          idempotencyKey: "mine",
        });
        const viaB = { projectId: projectB, experimentRef: PUMP, idempotencyKey: "theirs" };
        assert.strictEqual(
          (yield* Effect.flip(systems.createRun({ ...viaB, path: "../a/sw" }))).reason,
          "outside_project",
        );
        assert.strictEqual(
          (yield* Effect.flip(systems.createRun({ ...viaB, path: `${rootA}/sw` }))).reason,
          "outside_project",
        );
        assert.strictEqual(
          (yield* Effect.flip(systems.getRun({ projectId: projectB, runId: run.runId }))).reason,
          "not_found",
        );
        assert.strictEqual(
          (yield* Effect.flip(systems.validate({ projectId: ProjectId.make("nope"), path: "sw" })))
            .reason,
          "not_found",
        );
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("traversal and symlinks are rejected", () =>
      Effect.gen(function* () {
        const { fs, path, rootA } = yield* workspace;
        const systems = yield* service({ [projectA]: rootA });
        assert.strictEqual(
          (yield* Effect.flip(systems.validate({ projectId: projectA, path: "sw/../.." }))).reason,
          "outside_project",
        );
        yield* fs.symlink(path.join(rootA, "sw"), path.join(rootA, "linked"));
        assert.strictEqual(
          (yield* Effect.flip(systems.validate({ projectId: projectA, path: "linked" }))).reason,
          "outside_project",
        );
        const escape = yield* Effect.flip(
          systems.createRun({
            projectId: projectA,
            path: "sw",
            experimentRef: "../outside.run.json",
            idempotencyKey: "escape",
          }),
        );
        assert.strictEqual(escape.reason, "invalid_model");
        assert.deepInclude(escape.diagnostics?.[0] ?? {}, { code: "E-REF-001" });
        const valid = yield* systems.validate({ projectId: projectA, path: "sw" });
        assert.include(valid.experiments, PUMP);
        assert.include(valid.expectedTraces, "expected/pump-nominal.trace.json");
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("a restart fails the run it interrupted and keeps what it committed", () =>
      Effect.gen(function* () {
        const { rootA } = yield* workspace;
        const before = yield* Scope.make();
        const first = yield* service({ [projectA]: rootA }).pipe(Scope.provide(before));
        const run = yield* first.createRun({
          projectId: projectA,
          path: "sw",
          experimentRef: LONG,
          idempotencyKey: "restart",
        });
        yield* progressed(first, run);
        yield* Scope.close(before, Exit.void);

        const second = yield* service({ [projectA]: rootA });
        const after = yield* second.getRun(ref(run));
        assert.strictEqual(after.status, "failed");
        assert.strictEqual(after.hostDiagnostic?.code, "interrupted");
        assert.isAbove(after.eventCount, 0);
        const events = (yield* allEvents(second, after, 500)).flatMap((page) => page.events);
        assert.strictEqual(events.length, after.eventCount);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("DUR-001: a reconnecting client sees the same run, status and cursors", () =>
      Effect.gen(function* () {
        const { rootA } = yield* workspace;
        const systems = yield* service({ [projectA]: rootA });
        const input = {
          projectId: projectA,
          path: "sw",
          experimentRef: PUMP,
          idempotencyKey: "dur",
        };
        // First connection: create, watch, then drop the subscription mid-run.
        const created = yield* systems.createRun(input);
        const watcher = yield* systems
          .subscribeRuns({ projectId: projectA })
          .pipe(Stream.runDrain, Effect.forkChild);
        yield* Fiber.interrupt(watcher);
        const done = yield* systems.awaitRun(ref(created));
        const firstPage = yield* systems.runEvents({ ...ref(done), fromSequence: "0", limit: 10 });
        // Second connection: retrying the same create and reading again finds the same state.
        const retried = yield* systems.createRun(input);
        assert.strictEqual(retried.runId, created.runId);
        assert.deepStrictEqual(retried, done);
        const [listed] = (yield* systems
          .subscribeRuns({ projectId: projectA })
          .pipe(Stream.runHead)).pipe(Option.getOrThrow).runs;
        assert.deepStrictEqual(listed, done);
        assert.deepStrictEqual(
          yield* systems.runEvents({ ...ref(done), fromSequence: "0", limit: 10 }),
          firstPage,
        );
        const next = yield* systems.runEvents({
          ...ref(done),
          fromSequence: firstPage.nextSequence,
          limit: 10,
        });
        assert.strictEqual(next.events[0]?.sequence, firstPage.nextSequence);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("the shipped conformance pack passes in a worker", () =>
      Effect.gen(function* () {
        const systems = yield* service({});
        const result = yield* systems.executeConformance({});
        assert.deepStrictEqual(
          result.reports.map((report) => [report.id, report.status]),
          [
            ["DISC-001", "pass"],
            ["CHART-001", "pass"],
            ["CHART-002", "pass"],
            ["CLOCK-001", "pass"],
            ["NUM-001", "pass"],
            ["TIME-001", "pass"],
            ["TYPE-001", "pass"],
            ["GRAPH-001", "pass"],
          ],
        );
        assert.lengthOf((yield* systems.capabilities()).solvers, 2);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );
  }
});
