/**
 * The simulation side of a Systems run, shared by the worker thread and the in-process fallback
 * a single-file executable uses. The driver steps in bounded chunks and waits for the host after
 * each one, so the host commits before more is computed and a cancel lands between chunks.
 */
import type { ResolvedChart, ResolvedSystem } from "@t3tools/systems-compiler/compile";
import type { RunDocument } from "@t3tools/systems-model/documents";
import type { ModelDiagnostic } from "@t3tools/systems-model/diagnostics";
import type { RationalTime } from "@t3tools/systems-model/rational";
import type { RunStatus, SignalSample, TraceEvent } from "@t3tools/systems-model/trace";
import * as Effect from "effect/Effect";
import { validatePack, type PackFiles } from "@t3tools/systems-model/pack";
import { executeConformance, type FixtureReport } from "@t3tools/systems-runtime/conformance";
import { createSimulation } from "@t3tools/systems-runtime/simulate";

export interface RunJob {
  readonly kind: "run";
  readonly runId: string;
  readonly resolved: ResolvedSystem | ResolvedChart;
  readonly run: RunDocument;
  readonly chunkBoundaries: number;
}

/** Every fixture of every conformance manifest in a pack, run to completion. */
export interface ConformanceJob {
  readonly kind: "conformance";
  readonly files: PackFiles;
}

export type WorkerJob = RunJob | ConformanceJob;

export type ToWorker = { readonly type: "continue" } | { readonly type: "cancel" };

export type FromWorker =
  | {
      readonly type: "chunk";
      readonly time: RationalTime;
      readonly boundaries: number;
      readonly trace: ReadonlyArray<TraceEvent>;
      readonly samples: ReadonlyArray<SignalSample>;
    }
  | {
      readonly type: "done";
      readonly status: RunStatus;
      readonly lastCommittedTime: RationalTime;
      readonly boundaries: number;
      readonly diagnostics: ReadonlyArray<ModelDiagnostic>;
      readonly trace: ReadonlyArray<TraceEvent>;
      readonly samples: ReadonlyArray<SignalSample>;
    }
  | { readonly type: "conformance"; readonly reports: ReadonlyArray<FixtureReport> }
  /** A defect in the runtime itself; the message goes to the server log, never to clients. */
  | { readonly type: "error"; readonly message: string };

export interface DriverPort {
  readonly post: (message: FromWorker) => void;
  /** Resolves with the host's next command. */
  readonly next: () => Promise<ToWorker>;
}

/** Run one job to its end, posting each chunk's new trace and samples. */
export const driveRun = async (job: RunJob, port: DriverPort): Promise<void> => {
  let traceOffset = 0;
  let sampleOffset = 0;
  let boundaries = 0;
  const fresh = <A>(all: ReadonlyArray<A>, offset: number) => all.slice(offset);
  try {
    const simulation = createSimulation(job.resolved, job.run, { runId: job.runId });
    for (;;) {
      const progress = simulation.step(job.chunkBoundaries);
      if (progress.done) {
        const { outcome } = progress;
        port.post({
          type: "done",
          status: outcome.status,
          lastCommittedTime: outcome.lastCommittedTime,
          boundaries,
          diagnostics: outcome.diagnostics,
          trace: fresh(outcome.trace, traceOffset),
          samples: fresh(outcome.samples, sampleOffset),
        });
        return;
      }
      boundaries = progress.boundaries;
      const trace = fresh(progress.trace, traceOffset);
      const samples = fresh(progress.samples, sampleOffset);
      traceOffset = progress.trace.length;
      sampleOffset = progress.samples.length;
      port.post({ type: "chunk", time: progress.time, boundaries, trace, samples });
      if ((await port.next()).type === "cancel") {
        const outcome = simulation.cancel();
        port.post({
          type: "done",
          status: outcome.status,
          lastCommittedTime: outcome.lastCommittedTime,
          boundaries,
          diagnostics: outcome.diagnostics,
          trace: fresh(outcome.trace, traceOffset),
          samples: fresh(outcome.samples, sampleOffset),
        });
        return;
      }
    }
  } catch (cause) {
    port.post({
      type: "error",
      message: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
    });
  }
};

/** Commands arrive as events; hand them to a driver one `next()` at a time. */
export const commandInbox = () => {
  const buffered: Array<ToWorker> = [];
  const waiting: Array<(command: ToWorker) => void> = [];
  return {
    push: (command: ToWorker) => {
      const resolve = waiting.shift();
      if (resolve === undefined) buffered.push(command);
      else resolve(command);
    },
    next: () => {
      const command = buffered.shift();
      return command === undefined
        ? new Promise<ToWorker>((resolve) => waiting.push(resolve))
        : Promise.resolve(command);
    },
  };
};

export const conformanceOf = Effect.fn("SystemsWorker.conformance")(function* (files: PackFiles) {
  return yield* executeConformance(yield* validatePack(files));
});
